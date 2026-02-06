# Deployment Guide for VPS

This guide explains how to deploy the Sunoh API to a Virtual Private Server (VPS) using Docker and Docker Compose.

## Prerequisites

Ensure your VPS has the following installed:
1.  **Git**: To clone/pull the repository.
2.  **Docker**: To run the containers.
3.  **Docker Compose**: To orchestrate the API and Redis services.

### Installing Docker (Ubuntu/Debian)
Modern Docker installations include the Compose plugin by default.

```bash
# Update packages
sudo apt update
sudo apt install -y curl git

# Install Docker (includes docker-compose-plugin)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Post-install: Manage Docker as a non-root user
sudo usermod -aG docker $USER
# NOTE: You must log out and log back in for this to take effect!

```

## Initial Deployment

1.  **Clone the Repository**
    ssh into your VPS and run:
    ```bash
    git clone https://github.com/afkcodes/sunoh-api.git
    cd sunoh-api
    ```

2.  **Checkout the Branch**
    Typically you'd deploy from `main`, but ensuring you are on the right branch (e.g., `feature/dockerize` if not merged yet):
    ```bash
    git checkout feature/dockerize
    ```

3.  **Configure Environment Variables**
    Create a `.env` file in the project root. You can copy the example or create a new one:
    ```bash
    cp .env.example .env
    nano .env
    ```
    *Ensure you set `REDIS_HOST=redis` (the service name in docker-compose).*

4.  **Start the Services**
    Use the npm script added to `package.json`:
    ```bash
    npm run docker:up -- --build
    ```
    *Or run manually:*
    ```bash
    docker compose up -d --build
    ```

5.  **Verify Deployment**
    Check the logs to ensure everything started correctly:
    ```bash
    npm run docker:logs
    ```

## Updating the Deployment

When you have pushed new code to GitHub:

1.  **Pull Changes**
    ```bash
    git pull origin feature/dockerize
    ```

2.  **Rebuild and Restart**
    ```bash
    npm run docker:up -- --build
    ```

## Network & Security (Optional but Recommended)

By default, the API runs on port `3600`. To serve it efficiently on port `80` (HTTP) or `443` (HTTPS) with a domain name, use a reverse proxy like Nginx or Caddy.

### Quick Nginx Setup
1.  Install Nginx: `sudo apt install nginx`
2.  Edit config: `sudo nano /etc/nginx/sites-available/default`
3.  Add proxy pass:
    ```nginx
    server {
        listen 80;
        server_name your-domain.com;

        location / {
            proxy_pass http://localhost:3600;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
        }
    }
    ```
4.  Restart Nginx: `sudo systemctl restart nginx`
