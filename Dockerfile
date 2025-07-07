FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY index.html .
COPY styles.css .
COPY app.js .
COPY server.py .

# Create config directory
RUN mkdir -p config

# Expose port
EXPOSE 8595

# Run the Flask server
CMD ["python", "server.py"]