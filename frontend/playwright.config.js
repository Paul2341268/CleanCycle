import {defineConfig} from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
const python=process.env.CLEANCYCLE_PYTHON||['../.venv/Scripts/python.exe','../.venv/bin/python','../../.venv/Scripts/python.exe'].map(p=>path.resolve(p)).find(p=>fs.existsSync(p))||'python';
export default defineConfig({
  testDir:'./tests',workers:1,
  use:{baseURL:'http://127.0.0.1:8766',channel:'chrome'},
  webServer:{command:`"${python}" -m uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8766`,
    url:'http://127.0.0.1:8766/api/regions',reuseExistingServer:false,
    env:{CLEANCYCLE_ENV_FILE:'tests/.env.test',KMA_SERVICE_KEY:'',AIRKOREA_SERVICE_KEY:''}},
});
