FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Copy application files
COPY index.html .
COPY styles.css .
COPY app.js .
COPY server.py .

# Create config directory
RUN mkdir -p config

# Expose port
EXPOSE 8000

# Run the server
CMD ["python", "server.py"]