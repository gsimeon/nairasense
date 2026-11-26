# ADR-003: Hybrid inference, backend first

- Status: Accepted as project direction
- Decision: Backend inference first; evaluate browser inference later.
- Reason: Avoid premature device-specific model deployment.
- Consequence: Initial AI inference depends on network connectivity. Offline inference is not promised.
