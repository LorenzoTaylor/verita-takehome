[Design doc](DESIGN.md) · [Video walkthrough](https://youtu.be/iqO2MYE2cAQ) 

**Extras:** [Customer portal](https://customer-frontend-production-59e0.up.railway.app/) · [Ops console](https://ops-frontend-production.up.railway.app/) · [Decision log](decision.md)

### Live demo credentials

| | Email | Password |
|---|---|---|
| Customer portal | `test-7lv2wb@example.com` | `customer-local-password` |
| Ops console | `ops@example.com` | `ops-local-password` |

---

## Setup

**Prerequisites:** Rust, Node 18+, Docker

```bash
# 1. Start Postgres
docker compose up -d postgres

# 2. Copy env and fill in values
cp .env.example .env

# 3. Install frontend deps
npm install && cd frontend/customer && npm install && cd ../ops && npm install && cd ../..

# 4. Seed the database (runs migrations automatically on first start)
cd backend/api && cargo run --bin seed && cd ../..

# 5. Run everything
npm run dev
```

| Service | URL |
|---|---|
| Customer portal | http://localhost:5173 |
| Ops console | http://localhost:5174 |
| API | http://localhost:8080 |

The seed script prints the test customer's email and API key. Ops login uses whatever you set in `.env` (`OPS_SEED_EMAIL` / `OPS_SEED_PASSWORD`).
