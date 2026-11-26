# 0001. Two-Stage Inbound and Putaway Workflow

In warehouse logistics, the employee receiving a delivery and logging documentation does not immediately unwrap packages and shelve them into physical racks. We decided to split inbound inventory into two distinct operational stages:

1. **Staging Area (`Pending Putaway`)**: Newly accepted deliveries are held in temporary staging with no pre-assigned rack cell.
2. **Putaway Allocation**: Shelf operators scan physical cell QR codes (e.g. `A-01`) or enter cell codes manually, with support for splitting quantities across multiple cells and auto-suggesting cell capacity limits.

Audit movements record both operations distinctly (`INBOUND_RECEIVE` upon delivery dock check-in, and `PUTAWAY` upon rack cell placement).
