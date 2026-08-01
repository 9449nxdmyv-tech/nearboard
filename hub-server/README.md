# nearboard anchor node

BLE peripheral that keeps a nearboard board's history when nobody is in the room.

This is **optional**. It is an ordinary mesh peer that happens to always be on
and always in range — not infrastructure the app depends on. A group of phones
forms a board with no anchor at all; an anchor just means the board survives
everyone walking away.

## Two servers

| File | Protocol | Status |
| --- | --- | --- |
| `mesh-server.js` | Binary mesh packets over two characteristics | Current |
| `server.js` | Five characteristics, JSON payloads | Legacy, kept for reference |

`mesh-server.js` imports the packet and CRDT modules directly from the app's
`src/` (Node strips the TypeScript). A second copy of a wire format is a second
copy that drifts, and a framing bug that appears on only one side is miserable
to debug over BLE.

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
sudo node mesh-server.js --name "Coffee Shop Wall" --desc "Leave a note for regulars"
```

`sudo` is required on Linux for BLE peripheral access — without it bleno reports
`adapter state unauthorized` and never advertises. On macOS, grant Bluetooth
permissions to your terminal.

Requires Node 22.6+ for TypeScript type-stripping on the shared protocol modules.

## Options

- `--name` — Hub name (default: "nearboard hub")
- `--desc` — Hub description (default: none)

## Data

- `hub.json` — Hub identity and mesh peer id (auto-generated on first run)
- `posts.json` — All posts (created automatically)

Posts arriving more than once are merged rather than overwritten: engagement is
a CRDT, so two copies of a post carrying different likes combine instead of one
silently discarding the other's.
