FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Install Python dependencies
RUN pip install --no-cache-dir flask requests urllib3

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