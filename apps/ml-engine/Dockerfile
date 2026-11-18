FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# Generate a compatible, reproducible SYNTHETIC baseline for this scikit-learn build.
# Never unpickle a stale committed artifact from a different runtime.
RUN python -m app.ml.train_champion
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
