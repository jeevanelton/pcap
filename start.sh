#!/bin/bash

# PCAP Analyzer - Quick Start Script
# This script sets up and starts the PCAP Analyzer using Docker

set -e

echo "🚀 PCAP Analyzer - Quick Start"
echo "================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker is installed"
echo "✅ Docker Compose is installed"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    
    # Generate a random JWT secret
    if command -v python3 &> /dev/null; then
        SECRET=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
        # Update the .env file with generated secret
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/your-secret-key-change-this-in-production/$SECRET/" .env
        else
            sed -i "s/your-secret-key-change-this-in-production/$SECRET/" .env
        fi
        echo "✅ Generated secure JWT secret key"
    else
        echo "⚠️  Please manually set JWT_SECRET_KEY in .env file"
    fi
else
    echo "✅ .env file already exists"
fi

echo ""
echo "🐳 Starting Docker containers..."
echo ""

# Pull latest images
docker-compose pull

# Build and start containers
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo ""
    echo "✅ PCAP Analyzer is running!"
    echo ""
    echo "📍 Access points:"
    echo "   Frontend:  http://localhost"
    echo "   Backend:   http://localhost:8000"
    echo "   API Docs:  http://localhost:8000/docs"
    echo ""
    echo "🎯 Next steps:"
    echo "   1. Open http://localhost in your browser"
    echo "   2. Click 'Register' to create an account"
    echo "   3. Login and start analyzing PCAP files!"
    echo ""
    echo "📋 Useful commands:"
    echo "   View logs:     docker-compose logs -f"
    echo "   Stop:          docker-compose stop"
    echo "   Restart:       docker-compose restart"
    echo "   Remove:        docker-compose down"
    echo ""
else
    echo "❌ Failed to start services. Check logs with:"
    echo "   docker-compose logs"
    exit 1
fi
