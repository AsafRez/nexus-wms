# NexusWMS

Multi-tenant Warehouse Management System providing real-time 2D matrix inventory control, stock movements, and AI-assisted order processing.

## Language

**Storage Cell**:
A designated physical storage slot within a warehouse 2D grid matrix, holding inventory of a single SKU up to its maximum unit capacity.
_Avoid_: Place, spot, box, bin

**Cell Code**:
The canonical alphanumeric coordinate string representing a **Storage Cell**'s row letter and column number (e.g. `A-01`, `B-04`).
_Avoid_: Place number, cell address, shelf tag

**Staging Area**:
The temporary holding buffer where received deliveries wait to be unpacked, inspected, and put away into rack cells.
_Avoid_: Waiting place, unwrap area, holding dock

**Putaway**:
The operation of transferring received items from the **Staging Area** into one or more designated **Storage Cells**, optionally splitting quantities across cells.
_Avoid_: Placing, inserting place, shelving

**In-Rack Inventory**:
Stock that has completed **Putaway** and is physically stored inside assigned **Storage Cells**.
_Avoid_: In-place supplies, racked items
