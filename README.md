# NexusWMS — Enterprise Warehouse Management System

A multi-tenant, API-first **Warehouse Management System (WMS)** engineered with strict **Object-Oriented Programming (OOP)** principles so the exact same backend and shared TypeScript contracts power both the **Web Portal** and a future **Mobile App** (React Native / Expo).

---

## Architecture & OOP Foundations

- **Encapsulation & Rich Domain Models (`backend/src/domain/entities/`)**:
  - `BaseEntity`: Abstract base class providing identity equality and audit timestamps.
  - `WarehouseEntity`: Aggregate root encapsulating capacity calculations (`calculateUsedCapacity()`, `calculateAvailableCapacity()`, `calculateOccupancyPercentage()`, `getCapacityStatus()`, `computeZoneBreakdown()`).
  - `StorageLocationEntity`: Encapsulates slot occupancy state and stored item units.
  - `UserEntity` & `BusinessEntity`: Encapsulate multi-tenant ownership and role-based access rules.
  - `StockMovementEntity` -> `InboundMovementEntity` & `OutboundMovementEntity`: Inheritance and polymorphism for receiving vs. shipping operations.
- **Abstraction & Dependency Inversion (`backend/src/domain/repositories/`)**:
  - Domain services depend on `IUserRepository` and `IWarehouseRepository` interfaces rather than Prisma directly.
- **Shared Cross-Platform Contracts (`shared/wms.contracts.ts`)**:
  - Shared DTOs consumed by the React web frontend (and ready to import directly into a future React Native mobile app).
- **Frontend ViewModels & OOP Services (`frontend/src/models/`, `frontend/src/services/`)**:
  - `WarehouseViewModel`, `HttpClient`, `AuthApiService`, and `WarehouseApiService`.

---

## Demo Business Credentials

| Business | Email | Password | Warehouses Seeded |
| :--- | :--- | :--- | :--- |
| **Apex Global Logistics** | `admin@apex-wms.com` | `Admin123!` | **TLV-01** (54 / 100 = **54% Full**), **HFA-02** (68 / 80 = **85% Full**), **BSV-03** (36 / 120 = **30% Full**) |
| **Nova Retail Group** | `demo@novaretail.com` | `Demo123!` | **HRZ-01** (31 / 50 = **62% Full**), **ASD-02** (55 / 60 = **91.7% Full**) |

---

## Quick Start

### 1. Backend API (Port `3001`)
```bash
cd wms-platform/backend
npm install
npm run db:setup
npm run start:dev
```

### 2. Web Frontend (Port `5173`)
```bash
cd wms-platform/frontend
npm install
npm run dev
```

