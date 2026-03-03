# nearboard hub server

BLE peripheral that turns your laptop into a nearboard hub.

## Setup

```
cd hub-server
npm install
```

### Linux prerequisites

```
sudo apt install bluetooth bluez libbluetooth-dev libudev-dev
```

## Usage

```
sudo node server.js --name "Coffee Shop Wall" --desc "Leave a note for regulars"
```

`sudo` is required on Linux for BLE peripheral access. On macOS, you may need to grant Bluetooth permissions to your terminal.

## Options

- `--name` — Hub name (default: "nearboard hub")
- `--desc` — Hub description (default: none)

## Data

- `hub.json` — Hub identity (auto-generated on first run)
- `posts.json` — All posts (created automatically)
