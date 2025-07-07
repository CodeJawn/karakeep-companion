# KaraKeep HomeDash

A more compact home page dashboard style view for browsing your [KaraKeep](https://github.com/karakeep-app/karakeep) bookmarks. All Karakeep bookmarks are shown on one single page, organized by lists. This is meant to be a very simple and uncluttered dashboard to your bookmarks, all bookmark management capabilities are done through the full (and awesome) KaraKeep app.

![KaraKeep HomeDash Screenshot](screenshot.png)

## Features

- 📚 **Masonry Layout** - Efficient use of screen space with Pinterest-style columns
- 🔍 **Real-time Search** - Instantly filter bookmarks as you type
- 🖱️ **Drag & Drop** - Reorder lists to your preference
- 📱 **Responsive** - Works beautifully on desktop, tablet, and mobile
- 🔌 **API Integration** - Connects to KaraKeep via API with built-in CORS proxy
- 🔒 **Privacy-First** - Uses your own KaraKeep instance and API key

## Quick Start with Docker

### Prerequisites
- Docker and Docker Compose installed
- A running KaraKeep instance
- Your KaraKeep API key (get it from KaraKeep settings)

### Using Pre-built Image

1. Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  karakeep-homedash:
    image: ghcr.io/codejawn/karakeep-homedash:latest
    container_name: karakeep-homedash
    ports:
      - "8595:8595"
    volumes:
      # Config directory for persistence
      - ./config:/app/config
    restart: unless-stopped
```

2. Start the container:
```bash
docker-compose up -d
```

3. Edit the config file to add your API key:
```bash
# Edit ./config/config.json and add your KaraKeep API key
nano ./config/config.json
```

4. Open http://localhost:8595 in your browser

## Manual Installation

### Prerequisites
- Python 3.7+ with Flask
- A running KaraKeep instance
- Your KaraKeep API key

### Setup

1. Clone the repository:
```bash
git clone https://github.com/codejawn/karakeep-homedash.git
cd karakeep-homedash
```

2. Install Python dependencies:
```bash
pip install -r requirements.txt
# or manually: pip install flask requests urllib3
```

3. Start the server:
```bash
python server.py
```

4. Edit the config file:
```bash
# Edit config/config.json and add your KaraKeep API key
nano config/config.json
```

5. Open http://localhost:8595 in your browser

## Configuration

The application uses a `config/config.json` file for settings. On first run, a default config file will be created. You must edit this file to add your KaraKeep API key.

### Configuration Options

```json
{
  "karakeepUrl": "http://localhost:3000",
  "apiKey": "YOUR_KARAKEEP_API_KEY_HERE",
  "bookmarkTarget": "_self",
  "preferences": {
    "columnOrder": [],
    "columnLayout": {}
  }
}
```

| Option | Description | Default | Required |
|--------|-------------|---------|----------|
| `karakeepUrl` | URL to your KaraKeep instance | `http://localhost:3000` | Yes |
| `apiKey` | Your KaraKeep API key | Must be set | Yes |
| `bookmarkTarget` | Where to open bookmarks: `_self` (same tab) or `_blank` (new tab) | `_self` | No |
| `preferences.columnOrder` | Saved order of bookmark lists (managed automatically) | `[]` | No |
| `preferences.columnLayout` | Saved column layout (managed automatically) | `{}` | No |

### Getting Your API Key

1. Open your KaraKeep instance
2. Go to Settings → API
3. Create a new API key or copy an existing one
4. Add it to your `config/config.json`

## Development

### Running Locally

For development without Docker:

```bash
# Install dependencies
pip install -r requirements.txt

# Start the Flask development server
python server.py

# For development with auto-reload
FLASK_ENV=development python server.py
```

### Making Changes

1. Edit the HTML, CSS, or JavaScript files
2. Refresh your browser to see changes
3. Submit a pull request with your improvements!

### API Endpoints Used

KaraKeep HomeDash uses the following KaraKeep API endpoints:
- `GET /api/lists` - Fetch all bookmark lists
- `GET /api/bookmarks` - Fetch all bookmarks

The Flask server includes a built-in proxy that forwards these requests to avoid CORS issues when running on different domains.

## Troubleshooting

### "Invalid API key"
- Check that your API key is correctly set in `config/config.json`
- Ensure your KaraKeep instance is running and accessible
- Verify the API key has proper permissions

### Bookmarks not showing
- Verify your KaraKeep instance URL is correct in the config
- Check browser console for errors
- Ensure you have bookmarks in your KaraKeep instance

### CORS errors
- The Flask server includes a built-in proxy to handle CORS issues
- Make sure you're using the Flask server (`server.py`) and not a basic HTTP server
- The proxy automatically forwards requests to your KaraKeep instance

### Connection errors
- Check that KaraKeep is running and accessible at the configured URL
- Ensure there are no firewall or network issues
- If using Docker, make sure the containers can communicate
- For self-signed certificates, the proxy is configured to accept them

### Drag and drop not saving
- The config directory must be writable
- For Docker: Ensure the ./config volume is properly mounted

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the GNU V3 license - see the LICENSE file for details.

## Acknowledgments

- Built to complement the amazing [KaraKeep](https://github.com/karakeep-app/karakeep)
- Uses the [KaraKeep API](https://docs.karakeep.app/API/karakeep-api) for data access