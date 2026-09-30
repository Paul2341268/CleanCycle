FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8765 CLEANCYCLE_DB=/var/data/cleancycle.sqlite3
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app/ ./app/
COPY --from=frontend /build/dist /app/frontend/dist
RUN mkdir -p /var/data && useradd --uid 10001 --create-home cleancycle && chown -R cleancycle:cleancycle /var/data /app
USER cleancycle
EXPOSE 8765
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8765} --workers 1"]
