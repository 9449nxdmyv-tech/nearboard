# Notes for App Review

Paste the relevant sections into App Store Connect's review notes. They exist
because two things about this app are invisible to a reviewer testing alone.

## The app will look empty unless you do this

nearboard is a board shared with people **physically nearby**, over Bluetooth.
A reviewer testing alone, with no other nearboard device in Bluetooth range,
will correctly see "no one nearby yet" — the app is working, there is simply
nobody to talk to.

**To see it working with one device:**

1. Tap **start a hub** and give it any name
2. Open the board
3. Tap **⌁ Bluetooth only** in the header — it becomes **🌐 reaching beyond Bluetooth**
4. Post something

That routes the board over the internet as well as Bluetooth, so it works
without a second device present. Posting, the feed, reporting, blocking and
ephemeral posts are all reachable this way.

**To see the mesh itself**, two devices with the app installed, Bluetooth on,
within a few metres. Create a board on one; it appears on the other under
**Boards near you** within about ten seconds, with no name typed.

## Guideline 1.2 — user-generated content

All four requirements are implemented.

| Requirement | Where |
| --- | --- |
| Filter objectionable material | Posts reported by several people collapse behind a warning. Users can also mute words (About → Muted words). |
| Report objectionable content | Flag icon on every post by another author. |
| Block abusive users | Block icon on every post; managed at About → Blocked people. |
| Published contact info | About screen, and below. |

**Reporting works without a server.** A report adds to the post's `deranks`, a
conflict-free set that lowers the post's score on every device it reaches, and
blocks the author locally. Enough reports and the post sinks for everyone — the
arithmetic converges identically on every device.

**Blocking is durable.** `authorId` is an Ed25519 public key and every post is
signed against it, so an author cannot escape a block by reconnecting, changing
a name, or getting a new address.

Blocked content is still *relayed* but never *displayed*. Refusing to carry
traffic would partition the network for uninvolved people.

## Guideline 2.5.4 — background Bluetooth

`UIBackgroundModes` declares `bluetooth-central` and `bluetooth-peripheral`.
Both are load-bearing: a mesh node must be discoverable by others (peripheral)
while also discovering them (central). With either removed, a device can only
talk to people who happen to find it first, and the network stops forming.

## Encryption

`ITSAppUsesNonExemptEncryption` is `false`. The app uses Ed25519 signatures and
AES-GCM, both standard cryptography qualifying for exemption.

Note the honest limit, also stated in-app: the key for a board is derived from
the board's **name**, so anyone who knows or guesses the name can read it. This
protects boards from relay operators and passers-by; it is not private
messaging, and the About screen says so plainly rather than letting a user
assume otherwise.

## Privacy

No accounts, no analytics, no tracking, no advertising identifier, no server
holding content. Posts, keys and settings are on-device only.

Nutrition labels: **Data Not Collected**.

## Age rating

17+. Content comes from people nearby and is not reviewed before display.

## Contact

support@nearboard.app
