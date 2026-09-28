# Rummy 500

Play Rummy 500 against a friend, each in your own browser. No accounts, nothing to install.

**Play:** https://solomonmm876.github.io/rummy-500/

1. Open the page, type your name and click **Start a new table**.
2. Send your friend the invite link. They open it, type their name, and join.
3. Pick the settings (cards dealt, scoring system, Jokers, target score) and deal.

Extras: **👉 Poke** your opponent, **✋ Fake grab** on your turn (a hand reaches into the discard pile and puts it all back), **😏 Taunt** from a menu of 12, and **📷 video chat** in the side panel. **⚔️ Attacks** are purely visual: you each start with one wild attack, and whoever scores more in a hand gets three for the next one (break the table in half, release spiders, or make mushrooms sprout). **Card style** picks your card back (animals and mushrooms) and whether a hand or a foot picks up your cards. Drag cards to rearrange your hand, and listen for the chime when it's your turn.

The player who starts the table is the host: their browser runs the game and saves it, so keep that tab open while you play. If either of you reloads or drops out, the game picks up where it left off. The two browsers talk directly over WebRTC; the free [PeerJS](https://peerjs.com) server only introduces them.

## House rules

- Draw from the draw pile, or take any card from the discard pile along with every card above it. If you take more than one, the deepest card must be melded or laid off that turn. If you take only the top discard, you can't discard it again that turn.
- Sets are 3–4 cards of one rank in different suits; runs are 3+ cards in sequence in one suit. Aces are high or low; runs wrap (K-A-2) only with Advanced scoring.
- You can lay off on either player's melds; the points go to whoever plays the card.
- You go out only by discarding your last card, so you can never meld or lay off your whole hand.
- When the draw pile runs out, the discards (except the top card) are shuffled into a new one.
- Score = cards you put on the table minus cards left in your hand. First to the target (500 by default) wins.

## Development

Plain HTML, CSS and JavaScript, with no build step. `engine.js` holds the rules; `app.js` holds the UI and networking. Run the rules tests with macOS's built-in JavaScriptCore:

```sh
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc test/engine-test.js
```
