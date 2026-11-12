#!/usr/bin/env python3
"""
Yardline WMS — Helper Boxiy AI QA & RAG Evaluation Suite (OOP)
==============================================================
Evaluates Helper Boxiy (`POST /api/warehouses/:id/ai/chat`) against live
Neon PostgreSQL ground truth for Central Distribution Hub (TLV-01).

Core Evaluation Dimensions:
  1. Faithfulness        — Zero hallucinations; exact alignment with live DB numbers & strict abstention.
  2. Answer Relevance    — Directly addresses user intent (lookup, capacity, abstention, action, guardrail).
  3. Retrieval Precision — Resolves exact & typo-tolerant SKUs ("Litium" -> APX-BAT-110) and exact matrix cells.

Usage:
  python wms-platform/qa/qa_eval.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Ensure UTF-8 console output on Windows PowerShell (avoids cp1252 UnicodeEncodeError)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


# ============================================================================
# 1. Evaluation Domain Models
# ============================================================================


@dataclass
class AssertionRecord:
    dimension: str  # "faithfulness" | "relevance" | "retrieval"
    check: str
    passed: bool
    detail: str


@dataclass
class EvalMetrics:
    faithfulness: float
    answer_relevance: float
    retrieval_precision: float
    llm_judge_score: Optional[float] = None
    llm_judge_rationale: Optional[str] = None


@dataclass
class CaseEvaluationResult:
    case_id: str
    scenario: str
    title: str
    query: str
    expected_ground_truth: str
    agent_reply: str
    provider: str
    executed_actions: List[Dict[str, Any]]
    passed: bool
    latency_ms: float
    metrics: EvalMetrics
    assertions: List[AssertionRecord] = field(default_factory=list)


# ============================================================================
# 2. WMS Live API Client (Zero-Dependency OOP HTTP Client)
# ============================================================================


class WmsApiClient:
    """Authenticated HTTP client for the Yardline WMS NestJS API."""

    def __init__(self, base_url: str = "http://localhost:3001/api", timeout_sec: int = 20) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self._access_token: Optional[str] = None
        self.user_profile: Optional[Dict[str, Any]] = None

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self.base_url}/{path.lstrip('/')}"
        headers: Dict[str, str] = {"Accept": "application/json"}
        body_bytes: Optional[bytes] = None

        if self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"

        if payload is not None:
            headers["Content-Type"] = "application/json"
            body_bytes = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(url=url, data=body_bytes, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"HTTP {exc.code} on {method} {url}: {err_body}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"Cannot reach WMS backend at {self.base_url} ({exc.reason}). "
                "Ensure the NestJS backend is running on port 3001."
            ) from exc

    def login(self, email: str, password: str) -> Dict[str, Any]:
        res = self._request("POST", "/auth/login", {"email": email, "password": password})
        self._access_token = res["accessToken"]
        self.user_profile = res["user"]
        return res

    def list_warehouses(self) -> List[Dict[str, Any]]:
        return self._request("GET", "/warehouses")

    def get_dashboard(self, warehouse_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/warehouses/{warehouse_id}/dashboard")

    def get_locations(self, warehouse_id: str) -> List[Dict[str, Any]]:
        return self._request("GET", f"/warehouses/{warehouse_id}/locations")

    def get_inventory(self, warehouse_id: str) -> List[Dict[str, Any]]:
        return self._request("GET", f"/warehouses/{warehouse_id}/inventory")

    def get_catalog(self, warehouse_id: str) -> List[Dict[str, Any]]:
        return self._request("GET", f"/warehouses/{warehouse_id}/catalog")

    def adjust_inventory_direct(
        self,
        warehouse_id: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Direct REST fallback used only if emergency teardown is ever needed."""
        return self._request("POST", f"/warehouses/{warehouse_id}/inventory/adjust", payload)

    def ask_boxiy(
        self,
        warehouse_id: str,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> Tuple[Dict[str, Any], float]:
        t0 = time.perf_counter()
        res = self._request(
            "POST",
            f"/warehouses/{warehouse_id}/ai/chat",
            {"message": message, "history": history or []},
        )
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        return res, elapsed_ms


# ============================================================================
# 3. Live Ground Truth Snapshot (Neon PostgreSQL State Model)
# ============================================================================


class GroundTruthSnapshot:
    """Immutable point-in-time snapshot of a warehouse's live ground truth."""

    def __init__(
        self,
        dashboard: Dict[str, Any],
        locations: List[Dict[str, Any]],
        inventory: List[Dict[str, Any]],
        catalog: List[Dict[str, Any]],
    ) -> None:
        self.dashboard = dashboard
        self.warehouse = dashboard["warehouse"]
        self.metrics = dashboard["metrics"]
        self.locations = sorted(locations, key=lambda c: (c["row"], c["col"]))
        self.inventory = inventory
        self.catalog = catalog

        self.cells_by_code: Dict[str, Dict[str, Any]] = {
            c["code"].upper(): c for c in self.locations
        }
        self.inventory_by_sku: Dict[str, Dict[str, Any]] = {
            item["sku"].upper(): item for item in self.inventory
        }
        self.catalog_by_sku: Dict[str, Dict[str, Any]] = {
            prod["sku"].upper(): prod for prod in self.catalog
        }

    @classmethod
    def capture(cls, client: WmsApiClient, warehouse_id: str) -> "GroundTruthSnapshot":
        dashboard = client.get_dashboard(warehouse_id)
        locations = client.get_locations(warehouse_id)
        inventory = client.get_inventory(warehouse_id)
        catalog = client.get_catalog(warehouse_id)
        return cls(dashboard=dashboard, locations=locations, inventory=inventory, catalog=catalog)

    @property
    def open_cells(self) -> List[Dict[str, Any]]:
        return [c for c in self.locations if not c["isOccupied"] and c["currentItems"] == 0]

    @property
    def occupied_cells(self) -> List[Dict[str, Any]]:
        return [c for c in self.locations if c["currentItems"] > 0 and c.get("product") is not None]

    def cells_for_sku(self, sku: str) -> List[Dict[str, Any]]:
        target = sku.upper()
        return [
            c
            for c in self.occupied_cells
            if c.get("product") and c["product"]["sku"].upper() == target
        ]

    def sku_quantity(self, sku: str) -> int:
        inv = self.inventory_by_sku.get(sku.upper())
        return int(inv["quantity"]) if inv else 0


# ============================================================================
# 4. Hybrid Evaluator (Deterministic Live-DB Judge + Optional Gemini Judge)
# ============================================================================


class HybridJudge:
    """
    Computes Faithfulness, Answer Relevance, and Retrieval Precision from
    deterministic live-DB assertions, enriched by optional Gemini LLM-as-a-Judge.
    """

    def __init__(self, gemini_api_key: Optional[str] = None) -> None:
        self.gemini_api_key = (gemini_api_key or "").strip() or None

    @classmethod
    def from_environment(cls, backend_env_path: Path) -> "HybridJudge":
        key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not key and backend_env_path.exists():
            for line in backend_env_path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if stripped.startswith("GEMINI_API_KEY="):
                    val = stripped.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        key = val
                        break
        return cls(gemini_api_key=key or None)

    @property
    def llm_enabled(self) -> bool:
        return bool(self.gemini_api_key)

    @staticmethod
    def _score_dimension(assertions: List[AssertionRecord], dimension: str) -> float:
        relevant = [a for a in assertions if a.dimension == dimension]
        if not relevant:
            return 1.0
        passed_count = sum(1 for a in relevant if a.passed)
        return round(passed_count / len(relevant), 3)

    def _call_gemini_judge(
        self,
        query: str,
        ground_truth: str,
        agent_reply: str,
    ) -> Tuple[Optional[float], Optional[str]]:
        if not self.gemini_api_key:
            return None, None

        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"gemini-2.5-flash:generateContent?key={self.gemini_api_key}"
        )
        prompt = (
            "You are a strict QA evaluator for a Warehouse Management AI assistant named Helper Boxiy.\n"
            "Grade the assistant reply strictly against the Live Warehouse Ground Truth.\n"
            "Return ONLY valid JSON: {\"score\": <float 0.0 to 1.0>, \"rationale\": \"<one short sentence>\"}\n\n"
            f"User Query: {query}\n"
            f"Live Warehouse Ground Truth: {ground_truth}\n"
            f"Assistant Reply: {agent_reply}\n"
        )
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json"},
        }
        req = urllib.request.Request(
            url=url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                parsed = json.loads(text)
                return float(parsed.get("score", 0.0)), str(parsed.get("rationale", ""))
        except Exception as exc:  # pragma: no cover - graceful degradation if offline/quota
            return None, f"LLM judge unavailable ({type(exc).__name__})"

    def evaluate(
        self,
        case_id: str,
        scenario: str,
        title: str,
        query: str,
        expected_ground_truth: str,
        chat_response: Dict[str, Any],
        latency_ms: float,
        assertions: List[AssertionRecord],
    ) -> CaseEvaluationResult:
        reply = str(chat_response.get("reply", ""))
        provider = str(chat_response.get("provider", "UNKNOWN"))
        executed_actions = list(chat_response.get("executedActions", []))

        faithfulness = self._score_dimension(assertions, "faithfulness")
        relevance = self._score_dimension(assertions, "relevance")
        retrieval = self._score_dimension(assertions, "retrieval")

        llm_score, llm_rationale = self._call_gemini_judge(
            query=query,
            ground_truth=expected_ground_truth,
            agent_reply=reply,
        )

        all_passed = all(a.passed for a in assertions) and (
            llm_score is None or llm_score >= 0.7
        )

        return CaseEvaluationResult(
            case_id=case_id,
            scenario=scenario,
            title=title,
            query=query,
            expected_ground_truth=expected_ground_truth,
            agent_reply=reply,
            provider=provider,
            executed_actions=executed_actions,
            passed=all_passed,
            latency_ms=latency_ms,
            metrics=EvalMetrics(
                faithfulness=faithfulness,
                answer_relevance=relevance,
                retrieval_precision=retrieval,
                llm_judge_score=llm_score,
                llm_judge_rationale=llm_rationale,
            ),
            assertions=assertions,
        )


# ============================================================================
# 5. Helper Boxiy End-to-End QA Suite (5 Core Scenarios / 7 Test Cases)
# ============================================================================


class BoxiyQaEvaluationSuite:
    """Runs grounded QA scenarios against Central Distribution Hub (TLV-01)."""

    TARGET_WAREHOUSE_CODE = "TLV-01"

    def __init__(self, client: WmsApiClient, judge: HybridJudge) -> None:
        self.client = client
        self.judge = judge
        self.warehouse_id: str = ""
        self.warehouse_name: str = ""

    @staticmethod
    def _contains_number(text: str, value: int) -> bool:
        """Matches integer `value` whether formatted as `1250` or `1,250`."""
        plain = str(value)
        formatted = f"{value:,}"
        pattern_plain = rf"(?<!\d){re.escape(plain)}(?!\d)"
        pattern_fmt = rf"(?<!\d){re.escape(formatted)}(?!\d)"
        return bool(re.search(pattern_plain, text) or re.search(pattern_fmt, text))

    def setup(self, email: str, password: str) -> GroundTruthSnapshot:
        self.client.login(email, password)
        warehouses = self.client.list_warehouses()
        target = next(
            (w for w in warehouses if w["code"].upper() == self.TARGET_WAREHOUSE_CODE),
            None,
        )
        if not target:
            raise RuntimeError(f"Target warehouse {self.TARGET_WAREHOUSE_CODE} not found.")
        self.warehouse_id = target["id"]
        self.warehouse_name = target["name"]
        return GroundTruthSnapshot.capture(self.client, self.warehouse_id)

    # --- Scenario 1A: Exact SKU Lookup & Cell Grounding ---
    def test_exact_product_retrieval(self, truth: GroundTruthSnapshot) -> CaseEvaluationResult:
        sku = "APX-BAT-110"
        inv = truth.inventory_by_sku.get(sku) or truth.inventory[0]
        sku = inv["sku"]
        qty = int(inv["quantity"])
        holding_cells = [c["code"] for c in truth.cells_for_sku(sku)]

        query = f"Where is {sku} stored and how many units do we have?"
        resp, latency = self.client.ask_boxiy(self.warehouse_id, query)
        reply = resp.get("reply", "")

        missing_cells = [code for code in holding_cells if code not in reply]
        assertions = [
            AssertionRecord(
                "retrieval",
                f"Resolves target SKU {sku}",
                sku in reply and inv["productName"].lower() in reply.lower(),
                f"Expected '{sku}' and '{inv['productName']}' in reply.",
            ),
            AssertionRecord(
                "faithfulness",
                f"Reports exact live warehouse stock ({qty})",
                self._contains_number(reply, qty),
                f"Expected live quantity {qty} ({qty:,}) in reply.",
            ),
            AssertionRecord(
                "retrieval",
                f"Lists all {len(holding_cells)} occupied cells holding {sku}",
                len(missing_cells) == 0,
                f"Expected cells {holding_cells}; missing={missing_cells}.",
            ),
            AssertionRecord(
                "relevance",
                "Does not misclassify lookup as open-cells recommendation",
                "recommended open cells" not in reply.lower(),
                "Reply directly answers product location & stock.",
            ),
        ]

        expected_desc = (
            f"{sku} ({inv['productName']}): {qty} {inv['unitOfMeasure']} "
            f"across cells {holding_cells}"
        )
        return self.judge.evaluate(
            case_id="TC-01A",
            scenario="1. Product & Cell Retrieval",
            title="Exact SKU Stock & Cell Lookup",
            query=query,
            expected_ground_truth=expected_desc,
            chat_response=resp,
            latency_ms=latency,
            assertions=assertions,
        )

    # --- Scenario 1B: Typo-Tolerant Product Lookup ("Litium" Regression) ---
    def test_typo_litium_retrieval(self, truth: GroundTruthSnapshot) -> CaseEvaluationResult:
        inv = truth.inventory_by_sku.get("APX-BAT-110")
        if not inv:
            raise RuntimeError("Expected APX-BAT-110 in TLV-01 seed inventory for Litium test.")
        qty = int(inv["quantity"])
        holding_cells = [c["code"] for c in truth.cells_for_sku("APX-BAT-110")]

        query = 'Where can I find "Litium"?'
        resp, latency = self.client.ask_boxiy(self.warehouse_id, query)
        reply = resp.get("reply", "")

        missing_cells = [code for code in holding_cells if code not in reply]
        assertions = [
            AssertionRecord(
                "retrieval",
                'Fuzzy-matches typo "Litium" -> APX-BAT-110 (Lithium-Ion Backup Battery Pack)',
                "APX-BAT-110" in reply and "lithium" in reply.lower(),
                "Expected APX-BAT-110 / Lithium-Ion Backup Battery Pack.",
            ),
            AssertionRecord(
                "faithfulness",
                f"Grounds stock count to live DB ({qty} units)",
                self._contains_number(reply, qty),
                f"Expected live quantity {qty} in reply.",
            ),
            AssertionRecord(
                "retrieval",
                f"Returns actual occupied cells holding Lithium batteries ({holding_cells})",
                len(missing_cells) == 0,
                f"Expected cells {holding_cells}; missing={missing_cells}.",
            ),
            AssertionRecord(
                "relevance",
                "Regression check: never returns generic open cells for 'Where can I find ...'",
                "recommended open cells" not in reply.lower()
                and "empty cells out of" not in reply.lower(),
                "Confirmed 'where' + product name routes to product cell lookup.",
            ),
        ]

        expected_desc = (
            f'Typo "Litium" resolves to APX-BAT-110 ({qty} units) in cells {holding_cells}'
        )
        return self.judge.evaluate(
            case_id="TC-01B",
            scenario="1. Product & Cell Retrieval",
            title='Typo-Tolerant "Litium" Regression Test',
            query=query,
            expected_ground_truth=expected_desc,
            chat_response=resp,
            latency_ms=latency,
            assertions=assertions,
        )

    # --- Scenario 2A: Abstention on Non-Existent SKU ---
    def test_unknown_sku_abstention(self, _truth: GroundTruthSnapshot) -> CaseEvaluationResult:
        query = "How many units of SKU FAKE-X999 do we have in stock?"
        resp, latency = self.client.ask_boxiy(self.warehouse_id, query)
        reply = resp.get("reply", "")
        lower = reply.lower()

        abstains = (
            "cannot answer that yet" in lower
            or "couldn't find" in lower
            or "not in" in lower
        )
        no_fake_stock = not bool(re.search(r"\b\d+\s+(pcs|boxes|units|pallets)\b", lower))

        assertions = [
            AssertionRecord(
                "faithfulness",
                "Explicitly abstains on unknown SKU FAKE-X999",
                "cannot answer that yet" in lower and abstains,
                f"Reply abstention check: {reply[:120]}",
            ),
            AssertionRecord(
                "faithfulness",
                "Zero hallucinated unit quantities for FAKE-X999",
                no_fake_stock,
                "Confirmed no fabricated unit/pcs/boxes figure.",
            ),
            AssertionRecord(
                "relevance",
                "Executes zero warehouse mutations",
                len(resp.get("executedActions", [])) == 0,
                f"executedActions={resp.get('executedActions', [])}",
            ),
        ]

        return self.judge.evaluate(
            case_id="TC-02A",
            scenario="2. Abstention & Hallucination Traps",
            title="Non-Existent SKU Hallucination Trap",
            query=query,
            expected_ground_truth="SKU FAKE-X999 does not exist; assistant must state 'cannot answer that yet'.",
            chat_response=resp,
            latency_ms=latency,
            assertions=assertions,
        )

    # --- Scenario 2B: Abstention on Unsupported Attribute (Price) ---
    def test_unsupported_price_abstention(self, _truth: GroundTruthSnapshot) -> CaseEvaluationResult:
        query = "What is the unit price in dollars of APX-SCN-400?"
        resp, latency = self.client.ask_boxiy(self.warehouse_id, query)
        reply = resp.get("reply", "")
        lower = reply.lower()

        has_hallucinated_price = bool(re.search(r"\$\s*\d+|\b\d+(\.\d{2})?\s*(usd|dollars)\b", lower))

        assertions = [
            AssertionRecord(
                "faithfulness",
                "Explicitly states 'cannot answer that yet' for unstored price data",
                "cannot answer that yet" in lower,
                f"Reply: {reply[:120]}",
            ),
            AssertionRecord(
                "faithfulness",
                "Does not invent any dollar price ($XX.XX) for APX-SCN-400",
                not has_hallucinated_price,
                "Confirmed zero fabricated currency figures.",
            ),
            AssertionRecord(
                "relevance",
                "Clarifies what warehouse data IS available",
                any(k in lower for k in ["cell", "stock", "capacity", "warehouse data"]),
                "Guides operator to supported warehouse domains.",
            ),
        ]

        return self.judge.evaluate(
            case_id="TC-02B",
            scenario="2. Abstention & Hallucination Traps",
            title="Unsupported Attribute (Price) Trap",
            query=query,
            expected_ground_truth="Prices are not stored in WMS schema; assistant must state 'cannot answer that yet'.",
            chat_response=resp,
            latency_ms=latency,
            assertions=assertions,
        )

    # --- Scenario 3A: Live Warehouse Capacity Accuracy ---
    def test_live_capacity_ground_truth(self, truth: GroundTruthSnapshot) -> CaseEvaluationResult:
        wh = truth.warehouse
        occ_pct = int(wh["occupancyPercentage"])
        used_cap = int(wh["usedCapacity"])
        total_cap = int(wh["totalCapacity"])

        query = "What is the current occupancy percentage and cell capacity of this warehouse?"
        resp, latency = self.client.ask_boxiy(self.warehouse_id, query)
        reply = resp.get("reply", "")

        assertions = [
            AssertionRecord(
                "faithfulness",
                f"Matches exact live occupancy percentage ({occ_pct}%)",
                f"{occ_pct}%" in reply,
                f"Expected '{occ_pct}%' in reply.",
            ),
            AssertionRecord(
                "faithfulness",
                f"Matches live occupied/total matrix cells ({used_cap}/{total_cap})",
                self._contains_number(reply, used_cap) and self._contains_number(reply, total_cap),
                f"Expected usedCapacity={used_cap} and totalCapacity={total_cap}.",
            ),
            AssertionRecord(
                "retrieval",
                f"References active warehouse code ({wh['code']})",
                wh["code"] in reply or wh["name"] in reply,
                f"Expected {wh['name']} ({wh['code']}).",
            ),
            AssertionRecord(
                "relevance",
                "Directly summarizes warehouse utilization",
                "full" in reply.lower() or "occupied" in reply.lower(),
                "Clear capacity report returned.",
            ),
        ]

        expected_desc = (
            f"{wh['name']} ({wh['code']}) is {occ_pct}% full "
            f"({used_cap}/{total_cap} cells occupied)."
        )
        return self.judge.evaluate(
            case_id="TC-03A",
            scenario="3. Capacity & Cell Ground Truth",
            title="Live Warehouse Occupancy & Capacity Check",
            query=query,
            expected_ground_truth=expected_desc,
            chat_response=resp,
            latency_ms=latency,
            assertions=assertions,
        )

    # --- Scenario 3B: Specific Occupied Cell Inspection ---
    def test_specific_cell_inspection(self, truth: GroundTruthSnapshot) -> CaseEvaluationResult:
        if not truth.occupied_cells:
            raise RuntimeError("No occupied cells found in TLV-01 to inspect.")
        cell = truth.occupied_cells[0]
        code = cell["code"]
        cur = int(cell["currentItems"])
        max_u = int(cell["maxUnits"])
        prod = cell["product"]

        query = f"What is currently stored in cell {code}?"
        resp, latency = self.client.ask_boxiy(self.warehouse_id, query)
        reply = resp.get("reply", "")

        assertions = [
            AssertionRecord(
                "retrieval",
                f"Inspects requested cell {code}",
                code in reply,
                f"Expected cell code {code} in reply.",
            ),
            AssertionRecord(
                "faithfulness",
                f"Reports exact cell item count ({cur}/{max_u})",
                f"{cur}/{max_u}" in reply or self._contains_number(reply, cur),
                f"Expected {cur}/{max_u} items.",
            ),
            AssertionRecord(
                "retrieval",
                f"Identifies assigned single product {prod['sku']} ({prod['productName']})",
                prod["sku"] in reply and prod["productName"].lower() in reply.lower(),
                f"Expected {prod['sku']} ({prod['productName']}).",
            ),
            AssertionRecord(
                "relevance",
                "Read-only inspection executes zero mutations",
                len(resp.get("executedActions", [])) == 0,
                "Confirmed 0 mutations.",
            ),
        ]

        expected_desc = (
            f"Cell {code} holds {cur}/{max_u} items of {prod['sku']} ({prod['productName']})."
        )
        return self.judge.evaluate(
            case_id="TC-03B",
            scenario="3. Capacity & Cell Ground Truth",
            title=f"Live Cell Inspection ({code})",
            query=query,
            expected_ground_truth=expected_desc,
            chat_response=resp,
            latency_ms=latency,
            assertions=assertions,
        )

    # --- Scenario 4: Live Insert Mutation (+5) + Verified Auto-Cleanup (-5) ---
    def test_insert_action_and_cleanup(self, truth_before: GroundTruthSnapshot) -> CaseEvaluationResult:
        if not truth_before.open_cells:
            raise RuntimeError("No empty cell available in TLV-01 for safe mutation test.")

        open_cell = truth_before.open_cells[0]
        cell_code = open_cell["code"]
        target_inv = truth_before.inventory_by_sku.get("APX-SCN-400") or truth_before.inventory[0]
        sku = target_inv["sku"]
        product_id = target_inv["productId"]
        delta_qty = 5

        qty_before = truth_before.sku_quantity(sku)
        used_before = int(truth_before.warehouse["usedCapacity"])

        insert_query = f"Insert {delta_qty} {sku} into {cell_code}"
        insert_resp: Dict[str, Any] = {}
        insert_latency = 0.0
        inserted_in_db = False
        cleanup_ok = False
        truth_during: Optional[GroundTruthSnapshot] = None
        truth_after: Optional[GroundTruthSnapshot] = None

        try:
            insert_resp, insert_latency = self.client.ask_boxiy(self.warehouse_id, insert_query)
            truth_during = GroundTruthSnapshot.capture(self.client, self.warehouse_id)
            cell_during = truth_during.cells_by_code[cell_code]
            inserted_in_db = int(cell_during["currentItems"]) == delta_qty
        finally:
            # Guaranteed Cleanup: first via Helper Boxiy REMOVE, with direct REST fallback if needed
            if inserted_in_db:
                remove_query = f"Remove {delta_qty} {sku} from {cell_code}"
                self.client.ask_boxiy(self.warehouse_id, remove_query)
                truth_after = GroundTruthSnapshot.capture(self.client, self.warehouse_id)
                if int(truth_after.cells_by_code[cell_code]["currentItems"]) != 0:
                    # Emergency deterministic rollback so Neon DB is never left dirty
                    self.client.adjust_inventory_direct(
                        self.warehouse_id,
                        {
                            "action": "REMOVE",
                            "productId": product_id,
                            "quantity": delta_qty,
                            "row": open_cell["row"],
                            "col": open_cell["col"],
                            "partnerName": "QA Suite Rollback",
                        },
                    )
                    truth_after = GroundTruthSnapshot.capture(self.client, self.warehouse_id)
                else:
                    cleanup_ok = True
            else:
                truth_after = GroundTruthSnapshot.capture(self.client, self.warehouse_id)

        actions = insert_resp.get("executedActions", [])
        inbound_action_ok = (
            len(actions) == 1
            and actions[0].get("direction") == "INBOUND"
            and actions[0].get("sku") == sku
            and actions[0].get("cellCode") == cell_code
            and int(actions[0].get("quantity", 0)) == delta_qty
        )

        cell_during_state = truth_during.cells_by_code[cell_code] if truth_during else {}
        cell_after_state = truth_after.cells_by_code[cell_code] if truth_after else {}

        db_insert_verified = bool(
            truth_during
            and truth_during.sku_quantity(sku) == qty_before + delta_qty
            and int(cell_during_state.get("currentItems", -1)) == delta_qty
            and (cell_during_state.get("product") or {}).get("sku") == sku
            and int(truth_during.warehouse["usedCapacity"]) == used_before + 1
        )

        db_restored_cleanly = bool(
            cleanup_ok
            and truth_after
            and truth_after.sku_quantity(sku) == qty_before
            and int(cell_after_state.get("currentItems", -1)) == 0
            and cell_after_state.get("product") is None
            and int(truth_after.warehouse["usedCapacity"]) == used_before
        )

        assertions = [
            AssertionRecord(
                "relevance",
                f"Executes structured INBOUND tool action (+{delta_qty} {sku} -> {cell_code})",
                inbound_action_ok,
                f"executedActions={actions}",
            ),
            AssertionRecord(
                "faithfulness",
                f"Neon DB verified: {sku} stock +{delta_qty} & cell {cell_code} assigned to {sku}",
                db_insert_verified,
                f"Before qty={qty_before}, During qty={truth_during.sku_quantity(sku) if truth_during else 'N/A'}, "
                f"Cell items={cell_during_state.get('currentItems')}, Cell product={cell_during_state.get('product')}",
            ),
            AssertionRecord(
                "retrieval",
                f"Auto-cleanup via Boxiy REMOVE restored {cell_code} to empty (0/100, product=null)",
                db_restored_cleanly,
                f"After qty={truth_after.sku_quantity(sku) if truth_after else 'N/A'}, "
                f"Cell items={cell_after_state.get('currentItems')}, Cell product={cell_after_state.get('product')}",
            ),
        ]

        expected_desc = (
            f"Insert {delta_qty} {sku} into empty cell {cell_code} updates DB (+{delta_qty} units, "
            f"usedCapacity={used_before + 1}), followed by clean -5 teardown back to {qty_before} units."
        )
        return self.judge.evaluate(
            case_id="TC-04",
            scenario="4. Live Action Execution & Cleanup",
            title=f"Inbound Putaway (+{delta_qty} {sku} -> {cell_code}) + Rollback",
            query=insert_query,
            expected_ground_truth=expected_desc,
            chat_response=insert_resp,
            latency_ms=insert_latency,
            assertions=assertions,
        )

    # --- Scenario 5: 1-Product-Per-Cell Domain Guardrail Enforcement ---
    def test_single_product_per_cell_guardrail(
        self,
        truth_before: GroundTruthSnapshot,
    ) -> CaseEvaluationResult:
        candidate_cell = next(
            (c for c in truth_before.occupied_cells if int(c["currentItems"]) <= 95),
            None,
        )
        if not candidate_cell:
            raise RuntimeError("No occupied cell with <=95 items found in TLV-01 for guardrail test.")

        cell_code = candidate_cell["code"]
        existing_sku = candidate_cell["product"]["sku"]
        existing_items = int(candidate_cell["currentItems"])

        conflicting_prod = next(
            (p for p in truth_before.catalog if p["sku"].upper() != existing_sku.upper()),
            None,
        )
        if not conflicting_prod:
            raise RuntimeError("Need at least 2 catalog SKUs to test 1-product-per-cell conflict.")

        conflicting_sku = conflicting_prod["sku"]
        conflict_qty_before = truth_before.sku_quantity(conflicting_sku)

        query = f"Insert 5 {conflicting_sku} into {cell_code}"
        resp, latency = self.client.ask_boxiy(self.warehouse_id, query)
        reply = resp.get("reply", "")
        actions = resp.get("executedActions", [])

        truth_after = GroundTruthSnapshot.capture(self.client, self.warehouse_id)
        cell_after = truth_after.cells_by_code[cell_code]

        state_unchanged = (
            int(cell_after["currentItems"]) == existing_items
            and (cell_after.get("product") or {}).get("sku") == existing_sku
            and truth_after.sku_quantity(conflicting_sku) == conflict_qty_before
        )

        assertions = [
            AssertionRecord(
                "relevance",
                f"Blocks conflicting SKU {conflicting_sku} from entering {cell_code} (0 executedActions)",
                len(actions) == 0,
                f"executedActions={actions}",
            ),
            AssertionRecord(
                "faithfulness",
                f"Explains cell {cell_code} already holds {existing_sku} (1-product-per-cell rule)",
                existing_sku in reply and ("already holds" in reply.lower() or "1 product" in reply.lower()),
                f"Reply: {reply[:140]}",
            ),
            AssertionRecord(
                "retrieval",
                f"Neon DB state verified untouched ({cell_code} still {existing_items} x {existing_sku})",
                state_unchanged,
                f"Cell after: {cell_after['currentItems']} x {(cell_after.get('product') or {}).get('sku')}",
            ),
        ]

        expected_desc = (
            f"Cell {cell_code} already holds {existing_sku}; inserting {conflicting_sku} must be "
            "rejected by StorageLocationEntity 1-product-per-cell domain rule with 0 DB changes."
        )
        return self.judge.evaluate(
            case_id="TC-05",
            scenario="5. OOP Domain Guardrail Enforcement",
            title=f"1-Product-Per-Cell Conflict ({conflicting_sku} into {cell_code})",
            query=query,
            expected_ground_truth=expected_desc,
            chat_response=resp,
            latency_ms=latency,
            assertions=assertions,
        )

    def run_all(self, email: str, password: str) -> Dict[str, Any]:
        initial_truth = self.setup(email, password)

        results: List[CaseEvaluationResult] = [
            self.test_exact_product_retrieval(initial_truth),
            self.test_typo_litium_retrieval(initial_truth),
            self.test_unknown_sku_abstention(initial_truth),
            self.test_unsupported_price_abstention(initial_truth),
            self.test_live_capacity_ground_truth(initial_truth),
            self.test_specific_cell_inspection(initial_truth),
            self.test_insert_action_and_cleanup(initial_truth),
        ]

        # Refresh truth before Scenario 5 (confirms Scenario 4 left state pristine too)
        refreshed_truth = GroundTruthSnapshot.capture(self.client, self.warehouse_id)
        results.append(self.test_single_product_per_cell_guardrail(refreshed_truth))

        passed_count = sum(1 for r in results if r.passed)
        total_count = len(results)
        avg_faithfulness = round(sum(r.metrics.faithfulness for r in results) / total_count, 3)
        avg_relevance = round(sum(r.metrics.answer_relevance for r in results) / total_count, 3)
        avg_retrieval = round(sum(r.metrics.retrieval_precision for r in results) / total_count, 3)
        avg_latency = round(sum(r.latency_ms for r in results) / total_count, 1)

        llm_scores = [
            r.metrics.llm_judge_score for r in results if r.metrics.llm_judge_score is not None
        ]
        avg_llm_score = round(sum(llm_scores) / len(llm_scores), 3) if llm_scores else None

        return {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "targetWarehouse": {
                "id": self.warehouse_id,
                "code": self.TARGET_WAREHOUSE_CODE,
                "name": self.warehouse_name,
            },
            "judgeMode": (
                "HYBRID (Deterministic Live-DB Ground Truth + Gemini 2.5 Flash Judge)"
                if self.judge.llm_enabled
                else "DETERMINISTIC_LIVE_DB (Set GEMINI_API_KEY in backend/.env to enable Gemini LLM Judge)"
            ),
            "summary": {
                "totalCases": total_count,
                "passedCases": passed_count,
                "failedCases": total_count - passed_count,
                "passRatePct": round((passed_count / total_count) * 100.0, 1),
                "faithfulness": avg_faithfulness,
                "answerRelevance": avg_relevance,
                "retrievalPrecision": avg_retrieval,
                "llmJudgeAvgScore": avg_llm_score,
                "avgLatencyMs": avg_latency,
            },
            "cases": [asdict(r) for r in results],
        }


# ============================================================================
# 6. Console Reporter & CLI Entrypoint
# ============================================================================


def print_console_report(report: Dict[str, Any], report_path: Path) -> None:
    wh = report["targetWarehouse"]
    summary = report["summary"]
    cases = report["cases"]

    print("=" * 94)
    print("  HELPER BOXIY — AI QA & GROUNDED RAG EVALUATION REPORT")
    print("=" * 94)
    print(f"  Warehouse  : {wh['name']} ({wh['code']})")
    print(f"  Judge Mode : {report['judgeMode']}")
    print(f"  Timestamp  : {report['generatedAt']}")
    print("-" * 94)
    print(
        f"  {'ID':<7} | {'Status':<6} | {'Faith':<5} | {'Relev':<5} | {'Retrv':<5} | "
        f"{'Latency':<8} | {'Test Case'}"
    )
    print("-" * 94)

    for c in cases:
        status = "PASS" if c["passed"] else "FAIL"
        m = c["metrics"]
        print(
            f"  {c['case_id']:<7} | {status:<6} | "
            f"{m['faithfulness']:<5.2f} | {m['answer_relevance']:<5.2f} | "
            f"{m['retrieval_precision']:<5.2f} | {c['latency_ms']:>6.1f}ms | {c['title']}"
        )
        if not c["passed"]:
            print(f"          Query : {c['query']}")
            print(f"          Reply : {c['agent_reply']}")
            for a in c["assertions"]:
                if not a["passed"]:
                    print(f"          [X] ({a['dimension']}) {a['check']} -> {a['detail']}")

    print("-" * 94)
    print(
        f"  OVERALL    : {summary['passedCases']}/{summary['totalCases']} PASSED "
        f"({summary['passRatePct']}%)"
    )
    print(
        f"  METRICS    : Faithfulness={summary['faithfulness']:.3f}  |  "
        f"Answer Relevance={summary['answerRelevance']:.3f}  |  "
        f"Retrieval Precision={summary['retrievalPrecision']:.3f}"
    )
    if summary["llmJudgeAvgScore"] is not None:
        print(f"  LLM JUDGE  : Avg Score={summary['llmJudgeAvgScore']:.3f}")
    print(f"  AVG LATENCY: {summary['avgLatencyMs']} ms")
    print(f"  JSON REPORT: {report_path}")
    print("=" * 94)


def main() -> int:
    qa_dir = Path(__file__).resolve().parent
    wms_root = qa_dir.parent
    backend_env = wms_root / "backend" / ".env"
    report_path = qa_dir / "eval_report.json"

    api_url = os.environ.get("WMS_API_URL", "http://localhost:3001/api")
    email = os.environ.get("WMS_QA_EMAIL", "admin@apex-wms.com")
    password = os.environ.get("WMS_QA_PASSWORD", "Admin123!")

    client = WmsApiClient(base_url=api_url)
    judge = HybridJudge.from_environment(backend_env_path=backend_env)
    suite = BoxiyQaEvaluationSuite(client=client, judge=judge)

    report = suite.run_all(email=email, password=password)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print_console_report(report, report_path)

    return 0 if report["summary"]["failedCases"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

