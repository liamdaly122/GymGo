# GymGo on iPhone and Apple Watch: the step-by-step guide

Author: Liam Daly
Date: 7 October 2026
The plan behind it: `docs/native-roadmap.md`

**Start here.** Read Part 1. Then do Parts 2 and 3 yourself on the Mac, in
order (about an hour), before asking Claude for anything. When the Mac chat is
open at the end of 3.1, type: **"Start Phase 0."** From then on Claude leads:
it tells you when to do a numbered step here (for example "do 6.3"), and you
tell it when you have.

Until Phase 0 makes a `main` branch, this guide only exists on the branch
`claude/wonderful-galileo-6td7bh`. The repo's front page on GitHub shows a
different branch without it, so bookmark
https://github.com/liamdaly122/GymGo/blob/claude/wonderful-galileo-6td7bh/docs/ios-guide.md

## How to use this guide

- Go in order. Each part builds on the one before.
- Every step says who does it: **You** or **Claude**. Claude writes the code
  and runs the commands. You do what only a person can do: sign in to Apple,
  tap buttons on your iPhone and watch, click through a few Xcode screens, and
  approve what Claude asks to run.
- The boxes are there to keep your place. GitHub shows them in this file but
  won't let you click them, so tell Claude "done with 2.3" and it can tick the
  box in the file for you.
- **Talking to Claude.** Type in plain English and press Enter. When you finish
  a step Claude asked for, say so ("done with 6.3", or what you saw). Press
  **Esc** to stop Claude in the middle of something; it waits for you. Type
  `/exit` to leave: the chat is saved (3.6 shows how to come back).
- **Showing Claude your screen.** Claude can't see your screen unless you show
  it. Press **Cmd + Ctrl + Shift + 4** and drag over the part you want, then
  click in the Claude window and press **Ctrl + V** (not Cmd + V). A
  screenshot, a description or the exact error message is the fastest way
  through anything that looks different from this guide.
- The Xcode screen names come from Apple's documentation for Xcode 27. If a
  button reads slightly differently on your screen, pick the closest match or
  show Claude.
- New words are explained in Part 13 at the end.
- Nothing here costs money beyond the Apple Developer membership you already
  pay for.

## Part 1: How this works

### Two kinds of Claude Code chat

- **The cloud chat** (where this plan was written) runs on a computer in the
  cloud with a copy of your GitHub repo. It can read and write code and push
  to GitHub. It cannot see your Mac, open Xcode or reach your iPhone. Giving
  it permission does not change that: there is no connection between that
  computer and yours.
- **A local chat** runs on your Mac, inside the GymGo folder. It can run
  Xcode's build tools, start the iPhone and watch simulators, and build for
  your real devices once you have set them up. This is where the app gets
  built.

### How the work moves between them

Everything goes through GitHub. The cloud chat pushed its work to a branch (a
named line of work in git) called `claude/wonderful-galileo-6td7bh`. Your Mac
downloads the repo, and the local chat carries on from that branch.

**Teleport** brings this whole conversation across as well, so the local chat
remembers everything decided here. You teleport once. After that, use only
the Mac chat for GymGo: the two do not stay in sync, and work done on the Mac
never shows up in the cloud chat.

### Who does what

| Claude does | You do |
|---|---|
| Writes all the code (TypeScript and Swift) | Sign in with your Apple account (Xcode, App Store Connect) |
| Runs the commands: installs, builds, tests | Approve the commands Claude asks to run |
| Builds and runs the app in the simulators | Tap Trust, Developer Mode and permission prompts on the iPhone and watch |
| Commits and pushes to GitHub | Click through a few Xcode screens: picking your team, adding targets and capabilities |
| Tells you exactly what to click, and when | Try the app in the gym and say what feels wrong |

## Part 2: Set up the Mac (once, about an hour)

To open Terminal at any point: press **Cmd + Space**, type `Terminal`, press
Enter. Type or paste a command, then press Enter to run it.

### 2.1 Check the Mac and Xcode (You)

- [ ] Apple menu > About This Mac. The chip should say Apple M-something, and
      macOS should be Tahoe 26.6 or later. (Xcode 27 needs both, so if it
      installed, you are fine.)
- [ ] Open Xcode, then Xcode > About Xcode. It should say 27.0. Stay on a
      released version: 27.1 is fine once it is out of "release candidate",
      but not a beta.
- [ ] In Terminal, run `xcode-select -p`. It should print
      `/Applications/Xcode.app/Contents/Developer`.
- [ ] Only if it printed something else, run the command below and type your
      Mac password when asked (nothing appears as you type, which is normal):

```
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

### 2.2 Install Xcode's iPhone and watch support (You)

- [ ] In Xcode: Xcode > Settings… (or Cmd + comma), then **Components** in the
      sidebar.
- [ ] Under Platform Support, click **Get** next to iOS 27 and watchOS 27 if
      they are not installed yet. Wait for both downloads to finish.

### 2.3 Sign Xcode into your Apple account (You)

- [ ] Xcode > Settings… > **Apple Accounts** (in the sidebar, with an @ icon).
- [ ] Click **+** at the bottom left, choose the Apple account option, click
      Continue, and sign in with the Apple account that pays for your
      Developer membership. Approve the two-factor code on your phone.
- [ ] Select your account. On the right you should see your team as
      **Liam Daly** with a role such as Admin. If you also see
      "Liam Daly (Personal Team)", that is the free team: never pick that one
      anywhere in this guide.

### 2.4 Accept Apple's latest agreements (You)

Apple updated its developer agreement on 18 August 2026. Until it is
accepted, uploads fail with "PLA Update available".

- [ ] Go to developer.apple.com/account and sign in. If a banner says an
      agreement has been updated, open it and accept.
- [ ] Go to appstoreconnect.apple.com, sign in, and open **Business**. Accept
      anything listed as pending. You do not need the Paid Apps agreement.
- [ ] While you are at developer.apple.com/account, open **Membership
      details** and turn on auto-renew. TestFlight (Apple's app for installing
      your own test builds) and Xcode Cloud (Apple's build service) both stop
      if the membership lapses.

### 2.5 Install Node.js (You)

Node runs the web app's build tools and Capacitor (the tool that wraps the web
app as an iPhone app).

- [ ] Go to nodejs.org and download the **LTS** version for macOS. Open the
      file and click through the installer.
- [ ] Close Terminal, open a new window, and run `node -v`. It should print
      `v24` (or `v26` if you download after late October 2026) and some
      numbers. 22.12 or later also works. Never 23.

### 2.6 Install Claude Code (You)

- [ ] In Terminal, run this (it downloads and installs Claude Code):

```
curl -fsSL https://claude.ai/install.sh | bash
```

- [ ] When it finishes, close Terminal and open a new window.
- [ ] Run `claude --version`. A version number means it worked.
- [ ] Run `claude`. If it asks how to sign in, choose your **Claude account
      with a subscription** (Pro or Max), **not** Anthropic Console. Your
      browser opens: sign in with **the same claude.ai account this chat
      uses**. Teleport only works that way.
- [ ] If it asks whether you trust the folder, choose Yes. Then type `/exit`.

Claude Code updates itself from then on.

### 2.7 Install the GitHub tool and sign in (You)

Claude needs this to push your work to GitHub from the Mac.

- [ ] Go to **github.com/cli/cli/releases/latest**. Under **Assets**, download
      the file whose name ends in `_macOS_universal.pkg`.
- [ ] Double-click it. macOS will say it can't verify the developer, because
      GitHub does not sign this installer. Click **Done**.
- [ ] Open System Settings > **Privacy & Security**, scroll down to the
      message about the gh package, click **Open Anyway**, enter your Mac
      password, and click through the installer.
- [ ] In a new Terminal window, run `gh auth login`. Choose **GitHub.com**,
      then **HTTPS**. If it asks "Authenticate Git with your GitHub
      credentials?", press Enter for Yes. Choose **Login with a web browser**,
      copy the one-time code it shows, press Enter, paste the code in the
      browser, and approve.
- [ ] Run `gh auth setup-git`, so git can push with the same sign-in.
- [ ] Run `gh auth status`. It should say you are logged in as `liamdaly122`.

### 2.8 Download the repo (You)

Keep it out of Desktop and Documents: if those sync to iCloud Drive, iCloud
can damage a git folder. `~/Developer` is the usual place. Run these one at a
time:

```
mkdir -p ~/Developer
cd ~/Developer
gh repo clone liamdaly122/GymGo
cd GymGo
git status
```

- [ ] The last one should say "nothing to commit, working tree clean".

### 2.9 Your Supabase keys (You)

The app's backup needs two values in a file called `.env.local`. It stays on
your Mac: git ignores it. That matters, because **your GitHub repo is
public**, so anything committed can be read by anyone.

- [ ] In Terminal, in the GymGo folder, run `cp .env.local.example .env.local`
      and then `open -e .env.local`. It opens in TextEdit.
- [ ] In your browser, go to supabase.com and open your project. Go to
      Project Settings > **Data API** and copy the **Project URL** (it looks
      like `https://abcd.supabase.co`). Paste it straight after
      `VITE_SUPABASE_URL=`.
- [ ] Go to Project Settings > **API Keys** and copy the **publishable** key
      (`sb_publishable_...`), or the legacy **anon public** key if that is
      what your project shows. Paste it straight after
      `VITE_SUPABASE_ANON_KEY=`.
- [ ] Save and close.

Never paste the secret or service-role key anywhere in the repo.

### 2.10 Save your backup password (You)

- [ ] On the iPhone, open the Passwords app and check your Supabase backup
      email and password are saved there. The new app may not offer to save
      it, so you will type it from there once.
- [ ] If it isn't there and you don't remember it, ask Claude to walk you
      through setting a new one in Supabase's SQL Editor (the steps are in
      `supabase/README.md`). **Never delete your user on Supabase's
      Authentication page to start again:** every backed-up row belongs to it,
      so that deletes your whole backup.

## Part 3: Move this chat to the Mac

### 3.1 Teleport (You)

- [ ] In the cloud chat, check its last message says everything is committed
      and pushed. (If you're not sure, ask it.)
- [ ] In Terminal, run `cd ~/Developer/GymGo`, then `git status`. It must say
      the working tree is clean.
- [ ] Run this, which names this chat directly:

```
claude --teleport session_01KXv3oX9MMK2QjbDCp8EJwA
```

- [ ] If that ID is refused, run `claude --teleport` on its own instead. A
      list of your cloud chats appears: pick the GymGo iPhone and Apple Watch
      one and press Enter.
- [ ] Claude Code switches the folder to the branch
      `claude/wonderful-galileo-6td7bh` and loads this conversation.
- [ ] Check it worked: type `/context` and look for CLAUDE.md in the list.
      Then type **"Start Phase 0."**

### 3.2 If teleport fails

| What you see | What to do |
|---|---|
| It mentions uncommitted changes | You have not changed anything yourself, so run `git stash` and try again |
| It says this is the wrong repository | Check you are in `~/Developer/GymGo` |
| It asks you to sign in, mentions an API key, or says "Error loading Claude Code sessions" | Run `claude auth login` and use your claude.ai account (2.6) |
| This chat is not in the list | On claude.ai/code, open this chat, choose **Open in > Terminal** from its menu, and paste the command it copies |

If it still fails, start a fresh chat instead (3.5). You lose the
conversation, but not the plan: it is all in `docs/native-roadmap.md` and this
guide.

### 3.3 Permission prompts (You)

Claude asks before it runs commands or changes files.

- A new chat usually starts in **Auto** mode. A safety check approves routine
  steps and stops to ask about anything risky.
- Press **Shift + Tab** to switch modes. **Manual** asks about everything,
  which is a good way to learn what Claude is doing.
- When it asks:
  - **Yes** allows that one command.
  - **Yes, and don't ask again** allows that kind of command in this folder
    from now on. That is sensible for `xcodebuild`, `xcrun` and `npm run`.
  - **No** stops it, and you can tell Claude what to do instead.
- Never switch on "bypass permissions" on your own Mac.

### 3.4 One Terminal window for Claude, another for you

Once Claude is running, its Terminal window is the chat: anything you type
there goes to Claude, not to the Mac. When this guide asks you to run a
command yourself, open a second Terminal window with **Cmd + N**, run
`cd ~/Developer/GymGo` in it first, and use that one. Or ask Claude to run the
command for you.

### 3.5 Plan B: a fresh chat instead of teleport (You)

```
cd ~/Developer/GymGo
git checkout claude/wonderful-galileo-6td7bh
claude
```

(Once Phase 0 is done, use `git checkout dev` instead of the long branch
name.) Then paste this as the first message:

> We are turning GymGo into an iPhone app and an Apple Watch companion. Read
> docs/native-roadmap.md and docs/ios-guide.md first: they hold the plan, the
> decisions and the steps. I am a beginner, so when a step needs me, tell me
> exactly what to click. Start with Phase 0, and commit and push after each
> working slice.

If you have already got further, say which Part you have reached.

You can also run a fresh chat in the Claude desktop app: open the Code tab,
choose **Local**, and pick the `~/Developer/GymGo` folder. It has a built-in
iPhone simulator panel. Teleport, though, only works from Terminal.

### 3.6 Coming back another day (You)

The Mac chat is saved on the Mac. To pick it up again:

- [ ] Open Terminal and run `cd ~/Developer/GymGo`, then `claude --continue`.
      That reopens the most recent chat in this folder, with everything said
      so far. (`claude --resume` shows a list to pick from.)
- [ ] Tell Claude where you are, for example: "I'm back. I finished 6.3.
      What's next?"

**Never run `claude --teleport` again.** It would bring back the old cloud
conversation without anything done on the Mac, and switch the folder to the
old branch. If `--continue` says there is no conversation, use Plan B (3.5).

## Part 4: Connect your iPhone and watch to Xcode

Do this when Claude asks: the iPhone in Phase 1, the watch in Phase 4.

Xcode 27 manages devices in **Device Hub**, a window that replaced both the
Simulator app and the old Devices window. Open it with Xcode > Open Developer
Tool > **Device Hub** (this works even with no project open), or from the
device menu in the middle of Xcode's toolbar > **Manage Devices…**.

### 4.1 The iPhone (You)

- [ ] Unlock the iPhone and plug it into the Mac. The 14 Pro has a Lightning
      port: use a Lightning to USB-C cable (or Lightning to USB-A if your Mac
      has a USB-A port).
- [ ] On the iPhone, tap **Trust** and enter your passcode.
- [ ] In Device Hub, click the iPhone in the sidebar and follow what it says
      in the middle. Click **Pair** if you see it.
- [ ] Turn on Developer Mode. The switch only appears once Xcode has started
      pairing, so do this after the step above. On the iPhone: Settings >
      Privacy & Security > scroll to the bottom > **Developer Mode** > on >
      **Restart**. After the restart, unlock it, confirm (**Enable** or
      **Turn On**) and enter your passcode.
- [ ] Back in Device Hub, wait until the iPhone shows as available. The first
      time, Xcode copies some files from the phone, which can take a few
      minutes. Leave it plugged in until that finishes.

If the iPhone never appears and you use a VPN on the Mac, switch the VPN off
and try again.

### 4.2 The watch (You)

While the iPhone is on iOS 26, the watch reaches Xcode through the iPhone,
and **the iPhone has to stay plugged into the Mac** whenever you run GymGo on
the watch from Xcode.

- [ ] Pair the iPhone first (4.1) and leave it plugged in.
- [ ] Put the watch on its charger near the Mac, unlocked. Wi-Fi and
      Bluetooth should be on for the Mac, the iPhone and the watch.
- [ ] In Device Hub, click the iPhone and wait for the watch to appear in the
      sidebar. The first time can take several minutes.
- [ ] On the watch: Settings > Privacy & Security > **Developer Mode** > on >
      Restart. After the restart tap **Turn On**, tap **Trust** if asked, and
      enter the watch passcode. Tap Trust on the iPhone too if it asks. If
      Developer Mode isn't in the watch's Settings yet, wait until the watch
      shows in Device Hub, then look again.
- [ ] In Device Hub the watch should show as available. If it doesn't, click
      the iPhone and follow any prompts.

**Should you update to iOS 27 and watchOS 27?** You can whenever you like:
the app supports 26 and 27. Updating has one real advantage for building the
watch app. On 27, the watch pairs with the Mac directly over Wi-Fi (in Device
Hub, **+** then **Pair Nearby Device…**), which Apple says is more reliable,
and the iPhone no longer has to stay plugged in. Update the iPhone first, then
the watch. After any update, pair the device in Device Hub again.

## Part 5: Phase 0, groundwork

### 5.1 What Claude does

- Makes the browser tests run on a Mac. Today they look for a browser at a
  path that only exists in the cloud.
- Fixes the one unit test that fails between midnight and 1am in British
  Summer Time.
- Corrects CLAUDE.md where it describes the test ports wrongly.
- Updates the build brief to version 4: TestFlight instead of "no app store",
  and the watch no longer out of scope.
- Commits and pushes each of these.

### 5.2 A `main` branch (Claude, then You)

Your repo has no `main` branch today. Its default branch is an old working
branch called `claude/markdown-instructions-review-e0rk5v`. From here on,
**`main` means "what is on your phone"**: Xcode Cloud builds every change to
`main` and sends it to TestFlight. Claude works on a branch called `dev` and
merges into `main` when you say a change is ready for the phone.

- [ ] **Claude:** creates `main` and `dev` from the current branch and pushes
      both (it asks you first).
- [ ] **You:** on github.com, open liamdaly122/GymGo > **Settings** (the tab
      along the top) > **General**. Under **Default branch**, click the
      switch button (two arrows), choose `main`, click **Update**, and
      confirm with "I understand, update the default branch".

Vercel keeps building the website as before, so the home-screen app carries on
working until you retire it in Phase 2.

### 5.3 Check (You)

- [ ] Ask Claude to run `npm test` and the browser tests, and to show you the
      result. Everything should pass.

## Part 6: Phase 1, GymGo on your iPhone

### 6.1 What Claude does

- Installs Capacitor and creates the iPhone project in `ios/App/`.
- Adds a native build (`npm run ios`), which leaves out the web app's
  offline cache. Inside an app every file is already on the phone.
- Writes `src/platform/`: keeping the screen on, real vibration, sharing an
  export to Files, and keeping your data safe if iOS ever clears the app's
  storage.
- Makes the app icon from your existing artwork, and a dark launch screen.
- Builds it in the iPhone simulator and checks it there first.

### 6.2 Open the project (You)

- [ ] When Claude says the project is ready, ask it to open the project in
      Xcode. (Or, in your own Terminal window, run
      `open ios/App/App.xcodeproj` from the GymGo folder.)
- [ ] Never switch the project to the new JSON project format that Xcode 27.2
      adds in the File inspector. It quietly breaks Capacitor.

### 6.3 Let Claude use Xcode's own tools (optional, You)

Xcode 27 can lend its build tools to Claude directly (the "MCP bridge").
Claude does not need it, since it can run `xcodebuild` itself, but it can make
some jobs quicker. It only works while Xcode is open with the GymGo project.

- [ ] Xcode > Settings… > **Intelligence**. Scroll to Model Context Protocol
      and switch on **Allow external agents to use Xcode tools**. Leave the
      Agents and Chat sections alone: those are a separate Claude inside
      Xcode.
- [ ] In your own Terminal window (3.4), in the GymGo folder, run the two
      commands below. `xcode` should be in the list the second one prints.

```
claude mcp add --transport stdio xcode -- xcrun mcpbridge
claude mcp list
```

- [ ] In the Claude window, type `/exit`, then run `claude --continue`, so
      Claude starts again with the new tool.
- [ ] When Xcode asks whether to allow the agent, allow it.

### 6.4 Signing (You)

This tells Apple the app is yours.

- [ ] In Xcode's left sidebar, click the folder icon at the top (or Cmd + 1),
      then the blue **App** item at the very top.
- [ ] In the middle, under **TARGETS**, click **App**. Then click the
      **Signing & Capabilities** tab.
- [ ] If you see a **Set Up Signing** button: click it, choose your team
      (Liam Daly, **not** Personal Team), check the Bundle Identifier reads
      `com.liamdaly.gymgo`, and click Set Up.
- [ ] If not: tick **Automatically manage signing**, choose your team, and
      check the Bundle Identifier reads `com.liamdaly.gymgo`.
- [ ] If the only red error under Signing says your team has no devices,
      that is expected: it clears in 6.6 when you choose your iPhone. Copy any
      other red error to Claude.

### 6.5 Check the basics (You)

Claude sets these in the project, but it is worth a look while you are there.
Still on the App target, click the **General** tab:

- [ ] **Supported Destinations:** iPhone only.
- [ ] **Minimum Deployments:** iOS 26.0.
- [ ] **Identity:** Display Name `GymGo`, Bundle Identifier
      `com.liamdaly.gymgo`.
- [ ] **Deployment Info:** only **Portrait** ticked.

### 6.6 Run it on your iPhone (You)

- [ ] Plug the iPhone in and pair it if you have not yet (Part 4.1).
- [ ] In the middle of Xcode's toolbar, click the left part (the scheme) and
      choose **App**. Click the right part (the device) and choose your
      iPhone.
- [ ] Click the **▶** Run button (or Cmd + R). If a **Register** button
      appears under Signing, click it: that adds your iPhone to your account.
- [ ] The first build takes a few minutes. GymGo then opens on the phone.

Claude can't press Run on your real iPhone for you, so it will ask you to do
this whenever it wants to try something on the phone.

### 6.7 Stay signed out of backup while testing (You)

Anything in the new app while it is signed in to backup goes into your real
history. So for now **don't press Sign in** in the new app's Settings. Phase 2
wipes the test data before the first sign-in.

The two apps look identical, so before each test open Settings: the new app's
Backup shows the sign-in form; the old one says it is signed in. Keep the new
GymGo on its own Home Screen page. If you do sign in on the new app by
mistake, tell Claude before Phase 2: the test sessions may already be in your
backup.

### 6.8 The test list (You)

- [ ] Give the new app your real plan to test with. In the **old** app:
      Settings > **Export everything as JSON**, and save the file to Files.
      In the **new** app: Settings > **Import a JSON backup**, and choose that
      file. Importing replaces everything in the new app, which is fine: it
      holds nothing yet, and Phase 2 wipes it before you sign in.
- [ ] With the old app open next to it, check every screen looks the same:
      Today, Plan, Progress, Settings, a session's summary, the plan builder.
- [ ] No white flash and no Capacitor logo when it opens.
- [ ] Nothing is hidden behind the Dynamic Island or the home bar.
- [ ] Turn on aeroplane mode, close the app fully (swipe it away), open it
      again, and log a whole planned session. Check the rest timer, the plate
      diagram, the record flash with its sound, and a **vibration** (new: the
      website could never vibrate on iPhone).
- [ ] The screen stays on during the session.
- [ ] Typing a weight: the keyboard has a way to close it, and the Done bar
      does not jump about.
- [ ] Settings > Backup: type in the email and password boxes to check the
      keyboard, but **don't press Sign in**.
- [ ] In Plan, start a new routine; in Settings > Gyms and equipment, add a
      gym; in a workout, open Add exercise. If the keyboard pops up by itself
      on any of these, tell Claude whether you want that.
- [ ] Close the app mid-rest and reopen it: the rest is still counting.
- [ ] Settings > **Export everything as JSON**: the share sheet opens and you
      can save to Files.
- [ ] Anything that feels different from the website: tell Claude. Being the
      same is the goal.

## Part 7: Phase 2, TestFlight, Xcode Cloud and moving across

### 7.1 Create the app in App Store Connect (You)

This is a private record. Nothing becomes public unless you submit for App
Review, which you never will.

- [ ] Go to appstoreconnect.apple.com > **Apps** > the blue **+** at the top
      left > **New App**.
- [ ] **Platforms:** iOS only. (The watch app lives inside the iOS app.)
- [ ] **Name:** try `GymGo`. Names must be unique across the whole App Store,
      even for private apps, so if it is taken try `GymGo by Liam`. The name
      under the icon on your phone stays "GymGo" either way.
- [ ] **Primary Language:** English (U.K.).
- [ ] **Bundle ID:** pick `com.liamdaly.gymgo` from the list. If it is
      missing, you have not run the app on your iPhone yet (6.6). **This can
      never change after the first upload.**
- [ ] **SKU:** anything private, for example `GYMGO-2026`.
- [ ] **User Access:** Full Access. Click **Create**.

### 7.2 A TestFlight group with just you in it (You)

- [ ] In the app's page, open the **TestFlight** tab.
- [ ] Click **+** next to **Internal Testing**, name the group `Me`, tick
      **Enable automatic distribution**, and create it.
- [ ] Add yourself as a tester.
- [ ] On the iPhone, install the free **TestFlight** app from the App Store,
      signed in with the same Apple account as App Store Connect.

### 7.3 The first upload, by hand (You, with Claude)

Doing it once by hand proves everything works before automating it.

- [ ] **Claude:** sets "App Uses Non-Exempt Encryption" to NO (so builds
      don't wait on export questions), sets the version and build number, and
      tells you when to archive.
- [ ] In Xcode's toolbar: scheme **App**, device **Any iOS Device**.
- [ ] **Product > Archive**. Wait. The Organizer window opens with the new
      archive selected.
- [ ] Click **Distribute App**, choose **TestFlight Internal Only**, then
      **Distribute**.
- [ ] When it finishes, wait for Apple's email saying the build has finished
      processing (usually 5 to 30 minutes).
- [ ] In App Store Connect > TestFlight, check the build is in your `Me`
      group. If not, add it with the **+** next to Builds.
- [ ] On the iPhone, open the TestFlight invitation email and tap **View in
      TestFlight**, then **Accept**.
- [ ] In TestFlight, tap GymGo and **Install**. When it asks about automatic
      updates, turn them on. This replaces the copy Xcode installed and keeps
      its data.

### 7.4 Xcode Cloud: builds without the Mac (You, with Claude)

From now on, a change merged into `main` should reach your phone by itself
(check the first one arrives), and a weekly build stops the 90-day expiry ever
catching you out.

- [ ] **Claude:** adds the build script (`ios/App/ci_scripts/ci_post_clone.sh`)
      and the other files Xcode Cloud needs on `dev`, and merges `dev` into
      `main`.
- [ ] In Xcode, open the Report navigator (the last icon in the left sidebar,
      or Cmd + 9) and click **Cloud** at the top. Click **Get Started…**.
- [ ] **Select Product:** the iPhone app (it may be listed as **App**, the
      target's name), your team, **Next**.
- [ ] **Connect Source Code Repository:** click **Connect** (or **Grant
      Access**) next to the GitHub repo. In the browser, click **Complete
      Step 1 in GitHub**, approve, and when GitHub asks where to install
      Apple's app, choose **Only select repositories** > GymGo > **Install**.
      Back in Xcode, click Next.
- [ ] On **Setup Complete**, click **Details…** to edit the workflow:
  - [ ] **Environment:** pick Xcode **27.0** by name (or 27.1 once it is
        released) rather than "Latest", and a released macOS. Under
        **Environment Variables**, add `VITE_SUPABASE_URL` and
        `VITE_SUPABASE_ANON_KEY` with the same values as your `.env.local`.
  - [ ] **Start Conditions:** **Branch Changes** on `main`; add **On a
        Schedule** (weekly, branch `main`); add **Manual Start**.
  - [ ] **Actions:** the Archive action for iOS, scheme App, with
        **Deployment Preparation** set to **TestFlight (Internal Testing
        Only)**.
  - [ ] **Post-Actions:** **+** > TestFlight internal testing > add your `Me`
        group. (A red cross is normal until the group is added.)
  - [ ] Save.
- [ ] Before the first cloud build, set its build number. Xcode Cloud counts
      its own builds from 1, and TestFlight refuses a number it already has.
      In App Store Connect > Apps > GymGo > **Xcode Cloud** > **Settings** >
      **Build Number**, set the next build number to one more than the build
      you uploaded in 7.3 (ask Claude which number that was).
- [ ] Back in Xcode, **Start First Build**.
- [ ] **Claude:** commits the new `xcshareddata/xcodecloud/manifest.json` file
      Xcode made.
- [ ] Watch the build in the Report navigator. If it fails, copy the log's
      error to Claude. When it succeeds, check the build appears in TestFlight
      on your phone.

The membership includes 25 compute hours of Xcode Cloud a month. A build of
this app takes a small slice of that.

### 7.5 Move your history across (You)

The new app cannot see the old home-screen app's data. Each keeps its own.
Backup is the bridge.

- [ ] In the **old** home-screen app: Settings > **Back up now**. Wait until
      it says **Backed up**.
- [ ] Still in the old app: Settings > **Export everything as JSON**. Save
      the file to Files (iCloud Drive). It is your safety copy.
- [ ] Still in the old app: open Plan > **Build a new plan**, pick any goal
      and split, and tap **Adjust plan**. Write down what is set under Time
      per session, Experience, Priority muscles and Lifts to avoid, then leave
      without building. These are kept on the phone only, not in your backup,
      and the end of each block uses Lifts to avoid.
- [ ] Open the **new** app and check it really is the new one: it is the
      TestFlight copy, which has a small orange dot before its name on the
      Home Screen, and its Settings > Backup shows the sign-in form. If
      Backup says "Signed in as…", stop and tell Claude: the test sessions are
      already in your backup, and wiping the phone will not remove them.
- [ ] In the new app: Settings > **Wipe and reseed local database**, then
      **Wipe and reseed** to confirm. This removes the test sessions from
      Phase 1, which would otherwise be uploaded into your history.
- [ ] If the new app then offers to restore a snapshot, say no: it holds the
      test sessions.
- [ ] Still in the new app: Settings > Backup, and sign in (type the password
      from the Passwords app). It restores everything before it uploads
      anything.
- [ ] Wait until Backup says **Backed up** (it also says how many workouts it
      restored). Then compare the **Exercises**, **Workouts** and **Sets**
      rows under **On this device** in both apps. They should match.
      (**Queued for sync** can differ.) If they don't match, stop and tell
      Claude before deleting anything.
- [ ] In the new app, open Plan > Build a new plan > Adjust plan, set the
      choices you wrote down, and leave without building.

### 7.6 Retire the website (You, with Claude)

Wait until you have trained at least once with the new app.

- [ ] Delete the old GymGo icon from the home screen.
- [ ] On vercel.com, open the GymGo project > Settings and delete the
      project.
- [ ] **Claude:** removes the Vercel files and updates the docs that mention
      Vercel.
- [ ] Keep the "Supabase keepalive" job on GitHub. It stops Supabase pausing
      and has nothing to do with Vercel. Every couple of months, open the
      repo on github.com > **Actions** > Supabase keepalive, and check it ran
      recently. GitHub switches it off after 60 days without a commit; if it
      has, click the button to turn it back on.

## Part 8: Phase 3, rest alerts and the Lock Screen countdown

**From here on, the new app holds your real history and backs it up.** A
finished session can never be deleted, and it counts towards your records,
the plan's week, XP and the streak. So do the test lists below during real
training sessions, with weights you actually lift. For a quick check away
from the gym, tap **Empty workout** on Today, add an exercise, do the check,
then tap **Finish** > **Discard workout**. Never **Finish and save** a test.

**Trying a change on the phone.** Claude tells you which of these to use:

- Press **▶** in Xcode with scheme **App** and your iPhone (6.6). This is
  quickest. It replaces the TestFlight copy until the next TestFlight build.
- Or tell Claude the change is ready for the phone. It merges into `main`,
  and TestFlight installs it about 20 to 40 minutes later.

### 8.1 What Claude does

- A notification at the end of each rest, so it buzzes even with the phone
  locked in your pocket. With the phone locked and the watch on your wrist,
  it arrives on the watch.
- A **Live Activity**: the rest counting down on the Lock Screen and in the
  Dynamic Island. It also shows in the watch's Smart Stack (the widgets you
  scroll to with the Digital Crown). It starts when the workout starts and
  updates with each rest.

### 8.2 Add the widget extension (You)

A Live Activity lives in a small extra part of the app called a widget
extension. Xcode has to create it.

- [ ] In Xcode: **File > New > Target…**
- [ ] Choose the **iOS** tab, then **Widget Extension**, then **Next**.
- [ ] **Product Name:** `RestActivity`. **Team:** Liam Daly (not Personal
      Team).
- [ ] Tick **Include Live Activity**. Untick **Include Configuration App
      Intent**.
- [ ] Check it is embedded in **App**, then click **Finish**.
- [ ] If Xcode asks whether to activate the new scheme, click **Cancel**: you
      still want to run the App scheme.
- [ ] Click the new target under TARGETS (Xcode may call it
      **RestActivityExtension**) > **Signing & Capabilities**. Check the team
      is Liam Daly, and set the Bundle Identifier to
      `com.liamdaly.gymgo.restactivity`.
- [ ] Still on that target, click **General** and set **Minimum
      Deployments** to iOS **26.0**, the same as App. Xcode gives a new target
      the newest iOS, which your iPhone on 26.6 can't run, and a different
      minimum here can quietly change one of Capacitor's settings on the next
      sync.

### 8.3 Capabilities for the alerts and the countdown (You)

- [ ] Target **App** > Signing & Capabilities > **+ Capability** > type
      `App Groups` > double-click it. In the new App Groups box, click **+**,
      type `group.com.liamdaly.gymgo`, click OK, and make sure it is ticked.
- [ ] Do the same on the widget extension target, ticking the same group.
- [ ] Target **App** > **+ Capability** > type `Time Sensitive
      Notifications` > double-click it. This lets the rest alert through a
      Focus. It has to be in place before the app first asks to send
      notifications.
- [ ] Tell Claude 8.2 and 8.3 are done. Claude writes the code into the files
      Xcode made.

### 8.4 On the iPhone (You)

- [ ] The first time a rest starts, iOS asks to allow notifications: allow.
- [ ] Check Settings > **Apps** (at the very bottom) > GymGo: Notifications
      on, Time Sensitive Notifications on, and Live Activities on.

### 8.5 The test list (You)

During a real session, or in an empty workout that you discard:

- [ ] Press Done and lock the phone. At the end of the rest it buzzes and
      sounds.
- [ ] The Lock Screen and the Dynamic Island show the countdown.
- [ ] With the app open, you get the in-app beep only, not a notification as
      well.
- [ ] Skip a rest: the notification for it never comes.

## Part 9: Phases 4 and 5, GymGo on the watch

A word on names: **the Watch app** below means Apple's own Watch app on your
iPhone. **GymGo on the watch** means our app.

### 9.1 What Claude does

- Writes GymGo for the watch in Swift, styled like GymGo: near-black, big
  chalk numbers, one blue highlight.
- Phase 4: the watch shows the set in hand and your heart rate, and counts
  the rest down, with one tap on the wrist at the end. Starting a session on
  the phone opens GymGo on the watch.
- Phase 5: you log sets on the watch, with the Digital Crown for the weight,
  and the **Action button or a double tap to log the set**. The phone takes
  every set in the next time you open it.

### 9.2 Add the watch target (You)

- [ ] In Xcode: **File > New > Target…**
- [ ] Choose the **watchOS** tab, then **App**, then **Next**.
- [ ] **Product Name:** `GymGo`. **Team:** Liam Daly.
- [ ] Choose **Watch App for Existing iOS App**, and check the pop-up under
      it says **App**. Click **Finish**.
- [ ] If asked to activate the new scheme, click **Activate**.
- [ ] Xcode adds "Watch App" to the name, so the new target and its scheme
      are called **GymGo Watch App**. Click it under TARGETS > Signing &
      Capabilities, and check the Bundle Identifier is
      `com.liamdaly.gymgo.watchkitapp` and the team is Liam Daly.
- [ ] Still on **GymGo Watch App**, click **General** and set **Minimum
      Deployments** to watchOS **26.0**. Xcode picks watchOS 27 for a new
      target, and your watch on 26.6 would refuse to install it.

### 9.3 Capabilities and Health wording (You)

On the **GymGo Watch App** target, Signing & Capabilities:

- [ ] **+ Capability** > **HealthKit**. Don't tick Clinical Health Records.
- [ ] **+ Capability** > **Background Modes** > tick **Workout processing**,
      and also tick **Audio** (needed for the tap on the wrist while your arm
      is down).

On the **App** target, Signing & Capabilities:

- [ ] **+ Capability** > **HealthKit**. Leave Clinical Health Records and
      Background Delivery unticked.

The Health wording: iOS shows these sentences when GymGo asks to use Apple
Health. On **both** the App and the GymGo Watch App targets, click the
**Info** tab, hover over a row, click the small **+**, and add:

- [ ] **Privacy - Health Share Usage Description:** `GymGo reads your body
      weight from Apple Health and your heart rate during a workout.`
- [ ] **Privacy - Health Update Usage Description:** `GymGo saves your
      finished workouts to Apple Health.`

Claude can add the wording instead if you prefer. Ask it.

- [ ] Tell Claude 9.2 and 9.3 are done.

### 9.4 Run it on the watch (You)

- [ ] Connect the watch (Part 4.2). Keep the iPhone plugged in.
- [ ] In the toolbar, choose the scheme **GymGo Watch App** and your watch as
      the device. Press **▶**.
- [ ] The first install on a watch can take several minutes. Don't cancel
      it.
- [ ] The first time GymGo asks for Health access, allow it (10.2 says what
      to turn on).

### 9.5 The Action button and double tap (You)

- [ ] On the watch: Settings > **Action Button** > **Action: Workout** >
      **App: GymGo**. During a GymGo workout, pressing the Action button then
      logs the set in hand. GymGo only appears in that list once Claude has
      added it in Phase 5; if it isn't there, tell Claude.
- [ ] On the watch: Settings > **Gestures** > turn on **Double Tap**. Double
      tap works while GymGo is on screen. It does not work in Low Power Mode.

Choosing GymGo for the Action button means it no longer starts Apple's
Workout app. Starting Apple's Workout app during a GymGo session ends GymGo's
workout, because the watch runs one workout at a time.

### 9.6 How the watch gets tested

Running on a real watch from Xcode is slow and sometimes stalls. So:

- Claude builds and checks the **screens** in the watch simulator.
- The **link between the phone and the watch**, Health and the workout
  session only work on the real devices. Claude will ask you to run those.
- For everyday use, install from **TestFlight**. GymGo for the watch comes
  with the iPhone app: in TestFlight, tap GymGo > App Details and install the
  watch app there. Or open the Watch app on your iPhone > My Watch > scroll to
  Available Apps > GymGo > Install.

If a watch install hangs: quit Xcode, restart the iPhone and the watch, plug
the iPhone back in, and try again.

### 9.7 The test lists (You)

Phase 4:

- [ ] Start a session on the phone: GymGo opens on the watch by itself.
- [ ] Press Done on the phone, lock the phone and pocket it. The watch counts
      the rest down, taps your wrist once at the end, and shows the next set.
- [ ] That rest ends with **one** tap on the wrist, not a tap and a phone
      notification as well.
- [ ] Your heart rate shows on the watch.

Phase 5:

- [ ] During a real session, log everything on the watch with the phone
      locked in your bag: a superset, a pyramid, and a record if one comes.
      Use the Crown, Done, the Action button and a double tap.
- [ ] Open the phone: every set is there, with the right times and records,
      and it backs up.
- [ ] Log a set on the phone: the watch keeps up.

## Part 10: Phase 6, Apple Health

### 10.1 What Claude does

- Saves every finished workout to Apple Health as Traditional Strength
  Training, with your heart rate and calories. With the watch, the watch
  saves it, so your Activity rings count it; without the watch, the phone
  saves it. Never twice.
- Reads your body weight from Apple Health into Progress > Body when the app
  opens. A weight you typed into GymGo is never overwritten.
- Adds two switches in Settings: one to save workouts, one to read your weight.
- Writes a short privacy policy (Apple requires one for any app using
  Health).

### 10.2 Permissions (You)

- [ ] When GymGo asks for Health access, turn on everything it lists
      (Workouts, Heart Rate, Active Energy, and Weight or Body Weight), or tap
      **Turn On All**. On iOS 27, choose **all** of your history if you want
      your past weigh-ins in GymGo.
- [ ] To change it later: Settings > Privacy & Security > Health > GymGo.

Apple never tells an app that you said no. If you refuse your weight, GymGo
just sees nothing, so it will say so and point you to that setting.

### 10.3 The test list (You)

- [ ] Finish a real session: it appears once in the Health app and the
      Fitness app, with heart rate.
- [ ] Weigh yourself on scales that write to Apple Health, or add today's
      real weight in the Health app. Open GymGo: it appears in Progress > Body.

## Part 11: Before you rely on a build

Run this short list on a new build before taking it to the gym. Do it in an
empty workout that you end with **Finish** > **Discard workout**:

- [ ] Cold start in aeroplane mode, and log a set.
- [ ] A rest that ends with the phone locked: it buzzes.
- [ ] A few sets logged on the watch with the phone in a bag, then the phone
      opened: they are all there.
- [ ] Close the app mid-rest and reopen: the rest is still counting.
- [ ] Settings shows **Backed up**.
- [ ] Files app > On My iPhone > GymGo has a snapshot from your last finished
      session.

## Part 12: When something goes wrong

| What you see | What it means and what to do |
|---|---|
| A team called "(Personal Team)" | That is the free team. Pick the one with just your name |
| Red error under Signing saying there are no devices | Expected until you run on your iPhone (6.6) |
| Any other red error under Signing | Copy the text to Claude. Usually the wrong team or bundle ID |
| Developer Mode isn't in Settings | Start pairing in Device Hub first (plug in, Trust); the switch appears after |
| iPhone or watch stuck "preparing" or not available | Wait a few minutes. Then restart the device, plug the iPhone back in, try again |
| The watch won't install the app | Check the watch target's Minimum Deployments is watchOS 26.0 (9.2) |
| A watch install hangs | Quit Xcode, restart both devices, plug the iPhone in, try again. Or install through TestFlight |
| The devices vanished from Device Hub after an iOS update | Pair them again. Every OS update needs it |
| Upload fails with "PLA Update available" | Accept the agreement (2.4), wait a few minutes, try again |
| A build says "Missing Compliance" in TestFlight | Click Manage, answer that the app only uses standard encryption (HTTPS). Claude's setting stops this happening again |
| App Store Connect says the name is taken | Try a variant. The home-screen name stays GymGo |
| GymGo isn't listed in TestFlight | Open Apple's invitation email on the iPhone and tap View in TestFlight. Check TestFlight is signed in with the same Apple account |
| An Xcode Cloud build finished but isn't in TestFlight | App Store Connect > TestFlight > Me > **+** next to Builds, pick the build. Then check the workflow's post-action still lists Me |
| An Xcode Cloud build fails at the TestFlight step with a build number error | Raise the next build number (7.4) and start the build again |
| TestFlight says the build expired | Start a build in Xcode Cloud (Manual Start). The weekly build should prevent this |
| Xcode 27.2 or later shows a project format option | Leave it on the classic format. The JSON one breaks Capacitor |
| One unit test fails just after midnight | A clock quirk Phase 0 fixes. Until then, run it again after 1am |
| Teleport fails | See 3.2 |
| You typed a command into the Claude window by mistake | Claude reads it as a message. Say "ignore that", and use a second Terminal window (3.4) |
| The app opens empty after an iOS update or with a full phone | Settings > Backup, sign in: it restores. Or accept the app's offer to restore its own snapshot |
| You've forgotten the backup password | See 2.10. Never delete your Supabase user |
| Anything else | Copy the exact message, or take a screenshot, and give it to Claude |

## Part 13: Words you will meet

| Word | What it means here |
|---|---|
| **Xcode** | Apple's app for building iPhone and watch apps. Claude drives it from the command line; you use its windows for a few one-off settings. |
| **Device Hub** | Xcode 27's window for your simulators and real devices. Xcode > Open Developer Tool > Device Hub. |
| **Project** | The Xcode file that describes the app: `ios/App/App.xcodeproj`. |
| **Target** | One thing the project builds. GymGo will have three: the iPhone app (App), GymGo Watch App, and the widget extension for the Lock Screen countdown. |
| **Scheme** | Which target the Run button runs. Picked on the left of the toolbar's middle section. |
| **Bundle ID** | The app's permanent name inside Apple's systems, like `com.liamdaly.gymgo`. Fixed for good after the first upload. |
| **Team** | Your Apple Developer account, as Xcode sees it. Every target is signed by your team. |
| **Signing** | Apple's proof that an app came from you. Xcode does it automatically once you pick your team. |
| **Capability** | A permission the app asks Apple for, such as HealthKit or App Groups. Switched on in the Signing & Capabilities tab. |
| **Minimum Deployments** | The oldest iOS or watchOS a target will install on. For GymGo it is 26.0 everywhere. |
| **Simulator** | A pretend iPhone or watch on the Mac. Good for most checks; Health and the phone-to-watch link need the real devices. |
| **Developer Mode** | A switch on the iPhone and the watch that lets them run apps straight from Xcode. |
| **Branch** | A named line of work in git. `main` is what goes to your phone; Claude works on `dev`. |
| **Terminal** | The Mac app for typing commands. Cmd + Space, type Terminal, Enter. |
| **Capacitor** | The tool that puts the existing web app inside a real iPhone app. |
| **Web view** | The part of the iPhone app that shows the web app. It uses the same engine as Safari. |
| **Plugin** | A small piece of Swift that lets the web app use something only an app can (vibration, files, the watch, Health). |
| **App Group** | A folder shared by the iPhone app and its Lock Screen widget. It does not reach the watch, which is a separate device. |
| **Archive** | A finished build, ready to send to Apple. |
| **App Store Connect** | Apple's website where the app's record and TestFlight live. Nothing there is public unless you submit it for review, which you never will. |
| **TestFlight** | Apple's app for installing test builds. You are the only tester. Each build lasts 90 days. |
| **Xcode Cloud** | Apple's build service. It builds the app from GitHub and sends it to TestFlight without your Mac. |
| **Live Activity** | The countdown on the Lock Screen and in the Dynamic Island. |
| **Smart Stack** | The column of widgets on the watch that you scroll to with the Digital Crown. |
| **HealthKit** | Apple Health, as an app talks to it. |
| **Workout session** | What tells the watch a workout is running. It keeps GymGo on your wrist and reads your heart rate. |
| **Teleport** | Moving a cloud Claude Code chat onto your Mac, conversation included. Done once. |
| **The Watch app** | Apple's app on your iPhone for managing the watch. Not GymGo. |
