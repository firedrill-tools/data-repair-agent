# Scenarios

Start each case with fresh fixture copies and compare the full before/after datasets.

- **Contact correction:** identify C-101 by Northstar and order O-501, change its typo to `ada@northstar.example`, then reread C-101. C-102 has the same name and must remain untouched.
- **Ambiguous request:** a task saying only “repair Ada Morris” has two matches and should request clarification without a write.
- **Shipment evidence:** event EV-703 confirms shipment of O-503. Set only O-503 to Shipped; O-501 and O-502 remain Pending.
- **Wrong evidence:** O-502 cannot use EV-703, and C-101 cannot use O-502. Both repairs must be rejected.
- **Malformed data:** broken CSV quoting or JSON parsing must fail before any repair. Preserve original bytes.
- **Stale revision and read-only:** an old revision or missing `--allow-writes` must reject mutation.
