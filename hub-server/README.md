# nearboard anchor node

An always-on peer that holds a board's history so it survives everyone walking
away.

**Optional by design.** A group of phones forms a board with no anchor at all.
An anchor just means the board is still there tomorrow.

## Run it

```bash
npm install
node anchor.js --name "Coffee Shop Wall"
```

That is the whole setup. No root, no system configuration, no Bluetooth
hardware required.

```
  nearboard anchor node
  hub:    Coffee Shop Wall
  id:     2c9ed3252e60e4b8cc82f2379decb034

[net] relays: connected — reachable from any platform
[anchor] ready: carrying "Coffee Shop Wall" over internet
```

Requires Node 22.6+ (the protocol modules are shared with the app as TypeScript
and rely on native type stripping).

### Options

| Flag | Meaning |
| --- | --- |
| `--name` | Hub name. **This is the address** — the id and the encryption key are both derived from it, so it must match what people type in the app, character for character after normalisation. |
| `--desc` | Description, cosmetic |
| `--no-bluetooth` | Skip BLE entirely |
| `--no-internet` | Local Bluetooth only |

## Why Bluetooth is optional

The anchor originally required a working BLE peripheral. That turned out to be a
hardware lottery, and a server that only runs on cooperative hardware is not a
server anyone can run.

Two independent problems:

- **bleno drives the HCI socket directly**, competing with `bluetoothd` — which
  every desktop Linux runs. The result is a peripheral that advertises
  convincingly and then refuses every connection.
- **BlueZ's own D-Bus path avoids that conflict**, and `bluez-peripheral.js`
  implements it. It registers a GATT application successfully, but not every
  controller can advertise through BlueZ's management API. The Broadcom chip this
  was developed on rejects even a completely empty advertisement with
  `Invalid Parameters (0x0d)`.

So Bluetooth is attempted, and its absence is reported rather than fatal. The
internet transport needs only an outbound WebSocket, so the anchor runs
unchanged on a VPS, a Raspberry Pi, a laptop, or in a container.

If your controller does support it, Bluetooth is used alongside — that is the
path that works with no internet at all.

## Privacy

Posts are encrypted before they leave the machine, with a key derived from the
hub **name**. Relays store an opaque blob tagged with a hash they cannot
reverse. Anyone who knows the hub name can read the board — the same rule the
Bluetooth side uses, where the name is both address and key. Nobody else can,
including the relay and including whoever runs this anchor.

A fresh IV per message, so a relay cannot tell that two people posted the same
thing.

## Files

| File | Purpose |
| --- | --- |
| `anchor.js` | The anchor node. Run this. |
| `bluez-peripheral.js` | BLE peripheral over BlueZ D-Bus |
| `mesh-server.js` | Older bleno-based anchor, kept for reference |
| `server.js` | Original five-characteristic JSON protocol, superseded |

### Diagnostics

Useful when a phone cannot see the anchor, or vice versa. A scan that finds
nothing is ambiguous on its own — a second radio is what makes the result mean
something.

```bash
node scan.js 12                    # what is actually on air nearby
node connect-dbus.js               # connect to a peer as a central, via BlueZ
node publish-test.js "Hub Name" "message"   # publish a post over the internet
```

## Data

- `hub.json` — identity: mesh peer id and Nostr key, generated on first run
- `posts.json` — the board

Posts arriving more than once are merged rather than overwritten. Engagement is
a CRDT, so two copies carrying different likes combine instead of one silently
discarding the other's.
