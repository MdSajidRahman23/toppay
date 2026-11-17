# Deploy guide (Banglish)

## 1. Files replace
1. D:\toppay-web folder-er purono `api`, `public`, `tests`, `tools` folder muche new zip-er gulo copy koro.
2. **vercel.json** ager moto thakbe — zip-e nai, ota delete/overwrite korbe na.
3. `requirements.txt` replace koro.

## 2. Local run
```
cd D:\toppay-web
pip install -r requirements.txt
python -m uvicorn api.index:app --reload
```
Browser: http://localhost:8000  (local-e USER_ID/USER_PASS env na dile admin panel theke shared login set koro.)

## 3. Test (optional)
```
pip install pytest httpx
python -m pytest tests -q
node --test tests/js/statement-core.test.js
```

## 4. Git
```
git status
git add .
git commit -m "v2: status logic, template layers, statement checker"
git push
```

## 5. Vercel
Settings → Environment Variables: `AUTH_SECRET` (long random), `ADMIN_USER`, `ADMIN_PASS`, (optional) `USER_ID`, `USER_PASS`, Upstash vars. Tarpor **Redeploy**.
**Important:** purono multi-user account ar kaj korbe na. Admin hoye ghure Admin tab-e "shared login" set koro.

## 6. Live verify
https://toppay-zeta.vercel.app → login → 1,940 din (pass), 1,500 din (return) → Templates tab → Statement tab-e PDF.

## 7. Rollback
Vercel → Deployments → ager deployment → "Promote to Production". Ba `git revert HEAD && git push`.

## Security note
Tomar ager zip-er `tests/browser_flows.py`-e ekta real-moto admin password chilo. Oi file repo theke soriye dao; password asol hole **ADMIN_PASS ebong AUTH_SECRET bodle dao**.
