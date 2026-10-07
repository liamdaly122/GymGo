# GymGo on iPhone and Apple Watch: the step-by-step guide

Author: Liam Daly
Date: 7 October 2026
The plan behind it: `docs/native-roadmap.md`

## How to use this guide

- Go in order. Each part builds on the one before.
- Every step says who does it: **You** or **Claude**. Claude writes the code
  and runs the commands. You do what only a person can do: sign in to Apple,
  tap buttons on your iPhone and Watch, click through a few Xcode screens, and
  approve what Claude asks to run.
- Tick the boxes as you go (GitHub shows them as checkboxes).
- The Xcode screen names come from Apple's documentation for Xcode 27. If a
  button reads slightly differently on your screen, pick the closest match or
  tell Claude what you see. Claude can't see your screen, so describing it (or
  pasting an error message) is the fastest way through.
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
  Xcode's build tools, start the iPhone and Watch simulators, and build for
  your real devices once you have set them up. This is where the app gets
  built.

### How the work moves between them

Everything goes through GitHub. The cloud chat pushed its work to a branch
(a named line of work in git) called `claude/wonderful-galileo-6td7bh`. Your
Mac downloads the repo, and the local chat carries on from that branch.

**Teleport** brings this whole conversation across as well, so the local chat
remembers everything decided here. After you teleport, use only the Mac chat
for GymGo. The two do not stay in sync: work done on the Mac never shows up in
the cloud chat.

### Who does what

| Claude does | You do |
|---|---|
| Writes all the code (TypeScript and Swift) | Sign in with your Apple account (Xcode, App Store Connect) |
| Runs the commands: installs, builds, tests | Approve the commands Claude asks to run |
| Builds and runs the app in the simulators | Tap Trust, Developer Mode and permission prompts on the iPhone and Watch |
| Commits and pushes to GitHub | Click through a few Xcode screens: picking your team, adding targets and capabilities |
| Tells you exactly what to click, and when | Try the app in the gym and say what feels wrong |

## Part 2: Set up the Mac (once, about an hour)

### 2.1 Check the Mac and Xcode (You)

- [ ] Apple menu > About This Mac. The chip should say Apple M-something, and
      macOS should be Tahoe 26.6 or later. (Xcode 27 needs both, so if it
      installed, you are fine.)
- [ ] Open Xcode, then Xcode > About Xcode. It should say 27.x. Stay on a
      released version (27.0 or 27.1), not a beta.
- [ ] Open Terminal: press Cmd + Space, type Terminal, press Enter. Then type
      this and press Enter:

      ```
      xcode-select -p
      ```

      It should print `/Applications/Xcode.app/Contents/Developer`. If it
      prints anything else, run this and type your Mac password when asked
      (nothing appears as you type, which is normal):

      ```
      sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
      ```

### 2.2 Install Xcode's iPhone and Watch support (You)

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
- [ ] While you are at developer.apple.com/account, check **Membership
      details** and turn on auto-renew, so TestFlight and Xcode Cloud never
      stop.

### 2.5 Install Node.js (You)

Node runs the web app's build tools and Capacitor.

- [ ] Go to nodejs.org and download the **LTS** version for macOS (24.x
      today). Open the file and click through the installer.
- [ ] Close Terminal, open a new window, and run `node -v`. It should print
      `v24` and some numbers. (22.12 or later also works. Never 23.)

### 2.6 Install Claude Code (You)

- [ ] In Terminal, paste this and press Enter:

      ```
      curl -fsSL https://claude.ai/install.sh | bash
      ```

- [ ] When it finishes, close Terminal and open a new window.
- [ ] Run `claude --version`. A version number means it worked.
- [ ] Run `claude`. It opens your browser: sign in with **the same claude.ai
      account this chat uses**. Teleport only works with that account,
      signed in this way (not with an API key). Then type `/exit` to leave.

Claude Code updates itself from then on.

### 2.7 Install the GitHub tool and sign in (You)

Claude needs this to push your work to GitHub from the Mac.

- [ ] Go to cli.github.com, download the macOS installer, open it and click
      through.
- [ ] In a new Terminal window, run `gh auth login`. Choose **GitHub.com**,
      then **HTTPS**, then **Login with a web browser**. Copy the one-time
      code it shows, press Enter, paste the code in the browser, and approve.
- [ ] Run `gh auth setup-git`, so plain git can push with the same sign-in.
- [ ] Run `gh auth status`. It should say you are logged in as `liamdaly122`.

### 2.8 Download the repo (You)

Keep it out of Desktop and Documents: if those sync to iCloud Drive, iCloud
can damage a git folder. `~/Developer` is the usual place.

- [ ] Run these one at a time:

      ```
      mkdir -p ~/Developer
      cd ~/Developer
      gh repo clone liamdaly122/GymGo
      cd GymGo
      git status
      ```

      The last one should say "nothing to commit, working tree clean".

### 2.9 Your Supabase keys (You)

The app's backup needs two values in a file called `.env.local`. It stays on
your Mac: git ignores it. That matters, because **your GitHub repo is
public**, so anything committed can be read by anyone.

- [ ] In Terminal, in the GymGo folder, run `cp .env.local.example .env.local`
      and then `open -e .env.local`. It opens in TextEdit.
- [ ] In your browser, go to supabase.com, open your project, then Project
      Settings > API Keys.
- [ ] Copy the Project URL (it looks like `https://abcd.supabase.co`) and paste
      it straight after `VITE_SUPABASE_URL=`.
- [ ] Copy the **publishable** key (`sb_publishable_...`), or the legacy
      **anon public** key if that is what your project shows, and paste it
      straight after `VITE_SUPABASE_ANON_KEY=`.
- [ ] Save and close.

Never paste the secret or service-role key anywhere in the repo.

### 2.10 Save your backup password (You)

- [ ] On the iPhone, open the Passwords app and check your Supabase backup
      email and password are saved there. The new app may not offer to save
      it, so you will type it from there once.

## Part 3: Move this chat to the Mac

### 3.1 Teleport (You)

- [ ] In Terminal: `cd ~/Developer/GymGo`, then `git status`. It must say the
      working tree is clean.
- [ ] Run:

      ```
      claude --teleport
      ```

- [ ] A list of your cloud sessions appears. Pick this one (the GymGo iPhone
      and Apple Watch roadmap) and press Enter.
- [ ] Claude Code switches the folder to the branch
      `claude/wonderful-galileo-6td7bh` and loads this conversation.
- [ ] Check it worked: type `/context` and look for CLAUDE.md in the list.
      Then ask: "Which branch are we on, and what is the first step?"

From here on, use the Mac chat for GymGo and leave the cloud chat alone.

### 3.2 If teleport fails

| What you see | What to do |
|---|---|
| It mentions uncommitted changes | You have not changed anything yourself, so run `git stash` and try again |
| It says this is the wrong repository | Check you are in `~/Developer/GymGo` |
| It asks you to sign in, or mentions an API key | Run `claude auth login` and use your claude.ai account |
| This session is not in the list | Run `claude update`, then try again |

If it still fails, start a fresh chat instead (3.5). You lose the
conversation, but not the plan: it is all in `docs/native-roadmap.md` and this
guide.

### 3.3 Permission prompts (You)

Claude asks before it runs commands or changes files.

- A new terminal session usually starts in **Auto** mode. A safety check
  approves routine steps and stops to ask about anything risky.
- Press **Shift + Tab** to switch modes. **Manual** asks about everything,
  which is a good way to learn what Claude is doing.
- When it asks:
  - **Yes** allows that one command.
  - **Yes, and don't ask again** allows that kind of command in this folder
    from now on. That is sensible for `xcodebuild`, `xcrun` and `npm run`.
  - **No** stops it, and you can tell Claude what to do instead.
- Never switch on "bypass permissions" on your own Mac.

### 3.4 Let Claude use Xcode's own tools (optional, You)

Xcode 27 can lend its build tools to Claude directly (the "MCP bridge").
Claude does not need it, since it can run `xcodebuild` itself, but it can make
some jobs quicker.

- [ ] Xcode > Settings… > **Intelligence**. Scroll to Model Context Protocol
      and switch on **Allow external agents to use Xcode tools**. Leave the
      Agents and Chat sections alone: those are a separate Claude inside
      Xcode.
- [ ] In Terminal, in the GymGo folder, run:

      ```
      claude mcp add --transport stdio xcode -- xcrun mcpbridge
      claude mcp list
      ```

      `xcode` should be in the list.
- [ ] It only works while Xcode is open with the GymGo project. When Xcode
      asks whether to allow the agent, allow it.

### 3.5 Plan B: a fresh chat instead of teleport (You)

```
cd ~/Developer/GymGo
git checkout claude/wonderful-galileo-6td7bh
claude
```

Then paste this as the first message:

> We are turning GymGo into an iPhone app and an Apple Watch companion. Read
> docs/native-roadmap.md and docs/ios-guide.md first: they hold the plan, the
> decisions and the steps. I am a beginner, so when a step needs me, tell me
> exactly what to click. Start with Phase 0, and commit and push after each
> working slice.

You can also run a fresh chat in the Claude desktop app: open the Code tab,
choose **Local**, and pick the `~/Developer/GymGo` folder. It has a built-in
iPhone simulator panel. Teleport, though, works from Terminal.

## Part 4: Connect your iPhone and Watch to Xcode

Do this when Claude asks: the iPhone in Phase 1, the Watch in Phase 4.

Xcode 27 manages devices in **Device Hub**, a window that replaced both the
Simulator app and the old Devices window. Open it from the device menu in the
middle of Xcode's toolbar: click the device name and choose **Manage
Devices…** at the bottom. (Or Xcode > Open Developer Tool > Device Hub.)

### 4.1 The iPhone (You)

- [ ] Unlock the iPhone and plug it into the Mac. The 14 Pro has a Lightning
      port, so use a Lightning to USB-C cable.
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

### 4.2 The Watch (You)

While the iPhone is on iOS 26, the Watch reaches Xcode through the iPhone,
and **the iPhone has to stay plugged into the Mac** whenever you run the Watch
app.

- [ ] Pair the iPhone first (4.1) and leave it plugged in.
- [ ] Put the Watch on its charger near the Mac, unlocked, with Wi-Fi and
      Bluetooth on for all three devices.
- [ ] On the Watch: Settings > Privacy & Security > **Developer Mode** > on >
      Restart. After the restart tap **Turn On**, tap **Trust** if asked, and
      enter the Watch passcode. Tap Trust on the iPhone too if it asks.
- [ ] In Device Hub the Watch should appear in the sidebar. The first time it
      can take several minutes to "prepare". If it doesn't appear, click the
      iPhone and follow any prompts.

**Should you update to iOS 27 and watchOS 27?** You can whenever you like:
the app supports 26 and 27. Updating has one real advantage for building the
watch app: on 27, the Watch pairs with the Mac directly over Wi-Fi (Device Hub
> **+** > **Pair Nearby Device…**), which Apple says is more reliable, and the
iPhone no longer has to stay plugged in. Update the iPhone first, then the
Watch. After any update, pair the device in Device Hub again.

## Part 5: Phase 0, groundwork

### 5.1 What Claude does

- Makes the browser tests run on a Mac. Today they look for a browser at a
  path that only exists in the cloud.
- Fixes the one unit test that fails between midnight and 1am in British
  Summer Time.
- Corrects CLAUDE.md where it describes the test ports wrongly.
- Updates the build brief to version 4: TestFlight instead of "no app store",
  and the Watch no longer out of scope.
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
      confirm.

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

- [ ] When Claude says the project is ready, open it. Either Claude opens it,
      or in Terminal (in the GymGo folder): `open ios/App/App.xcodeproj`.
- [ ] If Xcode ever offers to convert the project to a new format, say no.
      The new format (Xcode 27.2) breaks Capacitor.

### 6.3 Signing (You)

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
- [ ] There should be no red error under Signing. If there is, copy it to
      Claude.

### 6.4 Check the basics (You)

Claude sets these in the project, but it is worth a look while you are there.
Still on the App target, click the **General** tab:

- [ ] **Supported Destinations:** iPhone only.
- [ ] **Minimum Deployments:** iOS 26.0.
- [ ] **Identity:** Display Name `GymGo`, Bundle Identifier
      `com.liamdaly.gymgo`.
- [ ] **Deployment Info:** only **Portrait** ticked.

### 6.5 Run it on your iPhone (You)

- [ ] Plug the iPhone in and pair it if you have not yet (Part 4.1).
- [ ] In the middle of Xcode's toolbar, click the left part (the scheme) and
      choose **App**. Click the right part (the device) and choose your
      iPhone.
- [ ] Click the **▶** Run button (or Cmd + R). If a **Register** button
      appears under Signing, click it: that adds your iPhone to your account.
- [ ] The first build takes a few minutes. GymGo then opens on the phone.

Claude can't press Run on your real iPhone for you, so it will ask you to do
this whenever it wants to try something on the phone.

### 6.6 Stay signed out of backup while testing (You)

Anything you log in the new app while signed in to backup goes into your real
history. So for now **don't sign in** in the new app's Settings. Phase 2 wipes
the test data before the first sign-in.

### 6.7 The test list (You)

Try each, ideally with the old home-screen app open next to it:

- [ ] Every screen looks the same: Today, Plan, Progress, Settings, a
      session's summary, the plan builder.
- [ ] No white flash and no Capacitor logo when it opens.
- [ ] Nothing is hidden behind the Dynamic Island or the home bar.
- [ ] Turn on aeroplane mode, close the app fully (swipe it away), open it
      again, and log a whole planned session. The rest timer, the plate
      diagram, the record flash with its sound, and a **vibration** (new: the
      website could never vibrate on iPhone).
- [ ] The screen stays on during the session.
- [ ] Typing a weight: the keyboard has a way to close it, and the Done bar
      does not jump about.
- [ ] Close the app mid-rest and reopen it: the rest is still counting.
- [ ] Settings > Export everything: the share sheet opens and you can save
      to Files. Import a JSON file from Files.
- [ ] Anything that feels different from the website: tell Claude. Being the
      same is the goal.

## Part 7: Phase 2, TestFlight, Xcode Cloud and moving across

### 7.1 Create the app in App Store Connect (You)

This is a private record. Nothing becomes public unless you submit for App
Review, which you never will.

- [ ] Go to appstoreconnect.apple.com > **Apps** > the blue **+** at the top
      left > **New App**.
- [ ] **Platforms:** iOS only. (The Watch app lives inside the iOS app.)
- [ ] **Name:** try `GymGo`. Names must be unique across the whole App Store,
      even for private apps, so if it is taken try `GymGo by Liam`. The name
      under the icon on your phone stays "GymGo" either way.
- [ ] **Primary Language:** English (U.K.).
- [ ] **Bundle ID:** pick `com.liamdaly.gymgo` from the list. If it is
      missing, you have not run the app on your iPhone yet (6.5). **This can
      never change after the first upload.**
- [ ] **SKU:** anything private, for example `GYMGO-2026`.
- [ ] **User Access:** Full Access. Click **Create**.

### 7.2 A TestFlight group with just you in it (You)

- [ ] In the app's page, open the **TestFlight** tab.
- [ ] Click **+** next to **Internal Testing**, name the group `Me`, and
      create it.
- [ ] Add yourself as a tester.
- [ ] On the iPhone, install the free **TestFlight** app from the App Store.

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
- [ ] In App Store Connect > TestFlight, add the build to your `Me` group if
      it is not there already.
- [ ] On the iPhone, open TestFlight, tap GymGo, and **Install**. When it asks
      about automatic updates, turn them on. This replaces the copy Xcode
      installed and keeps its data.

### 7.4 Xcode Cloud: builds without the Mac (You, with Claude)

From now on, a change merged into `main` reaches your phone by itself, and a
weekly build stops the 90-day expiry ever catching you out.

- [ ] **Claude:** adds the build script (`ios/App/ci_scripts/ci_post_clone.sh`),
      commits the files Xcode Cloud needs, and pushes to `main`.
- [ ] In Xcode, open the Report navigator (the last icon in the left sidebar,
      or Cmd + 9) and click **Cloud** at the top. Click **Get Started…**.
- [ ] **Select Product:** GymGo, your team, **Next**.
- [ ] **Connect Source Code Repository:** click **Connect** (or **Grant
      Access**) next to the GitHub repo. In the browser, click **Complete
      Step 1 in GitHub**, approve, and when GitHub asks where to install
      Apple's app, choose **Only select repositories** > GymGo > **Install**.
      Back in Xcode, click Next.
- [ ] On **Setup Complete**, click **Details…** to edit the workflow:
  - [ ] **Environment:** pick Xcode **27.0** (or 27.1) by name rather than
        "Latest", and a released macOS. Under **Environment Variables**, add
        `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the same values
        as your `.env.local`.
  - [ ] **Start Conditions:** **Branch Changes** on `main`; add **On a
        Schedule** (weekly, branch `main`); add **Manual Start**.
  - [ ] **Actions:** the Archive action for iOS, scheme App, with
        **Deployment Preparation** set to **TestFlight (Internal Testing
        Only)**.
  - [ ] **Post-Actions:** **+** > TestFlight internal testing > add your `Me`
        group. (A red cross is normal until the group is added.)
  - [ ] Save, then **Start First Build**.
- [ ] **Claude:** commits the new `manifest.json` file Xcode made.
- [ ] Watch the build in the Report navigator. If it fails, copy the log's
      error to Claude.

The membership includes 25 build hours a month. A build of this app takes a
small slice of that.

### 7.5 Move your history across (You)

The new app cannot see the old home-screen app's data. Each keeps its own.
Backup is the bridge.

- [ ] In the **old** home-screen app: Settings > **Back up now**. Wait until
      it says **Backed up**.
- [ ] Still in the old app: Settings > **Export everything as JSON**. Save
      the file to Files (iCloud Drive). It is your safety copy.
- [ ] In the **new** app: Settings > **Wipe and reseed local database**, and
      confirm. This removes the test sessions from Phase 1, which would
      otherwise be uploaded into your history.
- [ ] Still in the new app: Settings > Backup, sign in (type the password
      from the Passwords app). It restores everything before it uploads
      anything.
- [ ] Compare **Settings > On this device** in both apps. The numbers should
      match.

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

### 8.1 What Claude does

- A notification at the end of each rest, so it buzzes even with the phone
  locked in your pocket. With the phone locked and the Watch on your wrist, it
  arrives on the Watch.
- A **Live Activity**: the rest counting down on the Lock Screen and in the
  Dynamic Island, also shown on the Watch's Smart Stack. It starts when the
  workout starts and updates with each rest.

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
      **RestActivityExtension**) > **Signing & Capabilities**, check the team
      is Liam Daly, and set the Bundle Identifier to
      `com.liamdaly.gymgo.restactivity`.
- [ ] Tell Claude it's done. Claude writes the code into the files Xcode made.

### 8.3 The shared folder: App Groups (You)

- [ ] Target **App** > Signing & Capabilities > **+ Capability** > type
      `App Groups` > double-click it.
- [ ] In the new App Groups box, click **+**, type `group.com.liamdaly.gymgo`,
      click OK, and make sure it is ticked.
- [ ] Do the same on the widget extension target (RestActivity or
      RestActivityExtension), ticking the same group.

### 8.4 On the iPhone (You)

- [ ] The first time a rest starts, iOS asks to allow notifications: allow.
- [ ] Check Settings > GymGo: Notifications on, and Live Activities on.

### 8.5 The test list (You)

- [ ] Start a session, press Done, lock the phone. At the end of the rest it
      buzzes and sounds.
- [ ] The Lock Screen and the Dynamic Island show the countdown.
- [ ] With the app open, you get the in-app beep only, not a notification as
      well.
- [ ] Skip a rest: the notification for it never comes.

## Part 9: Phases 4 and 5, the Watch app

### 9.1 What Claude does

- Writes the Watch app in Swift, styled like GymGo: near-black, big chalk
  numbers, one blue highlight.
- Phase 4: the Watch shows the set in hand and counts the rest down, with a
  tap on the wrist at the end. Starting a session on the phone opens it on the
  Watch.
- Phase 5: you log sets on the Watch, with the Digital Crown for the weight,
  and the **Action button or a double tap to log the set**. The phone takes
  every set in the next time you open it.

### 9.2 Add the Watch target (You)

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
- [ ] Tell Claude it's done.

### 9.3 Capabilities and Health wording (You)

On the **GymGo Watch App** target, Signing & Capabilities:

- [ ] **+ Capability** > **HealthKit**. Don't tick Clinical Health Records.
- [ ] **+ Capability** > **Background Modes** > tick **Workout processing**,
      and also tick **Audio** (needed for the tap on the wrist while the
      watch is lowered).

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

### 9.4 Run it on the Watch (You)

- [ ] Connect the Watch (Part 4.2). Keep the iPhone plugged in.
- [ ] In the toolbar, choose the scheme **GymGo Watch App** and your Watch as
      the device. Press **▶**.
- [ ] The first install on a Watch can take several minutes. Don't cancel it.
- [ ] The first time GymGo asks for Health access, allow it.

### 9.5 The Action button and double tap (You)

- [ ] On the Watch: Settings > **Action Button** > **Action: Workout** >
      **App: GymGo**. During a GymGo workout, pressing the Action button then
      logs the set in hand.
- [ ] On the Watch: Settings > **Gestures** > turn on **Double Tap**. Double
      tap works while GymGo is on screen. It does not work in Low Power Mode.

Choosing GymGo for the Action button means it no longer starts Apple's
Workout app. Starting Apple's Workout app during a GymGo session ends GymGo's
workout, because the Watch runs one workout at a time.

### 9.6 How the Watch gets tested

Running on a real Watch from Xcode is slow and sometimes stalls. So:

- Claude builds and checks the **screens** in the Watch simulator.
- The **link between phone and Watch**, Health and the workout session only
  work on the real devices. Claude will ask you to run those.
- For everyday use, install from **TestFlight**. The Watch app comes with the
  iPhone app: in TestFlight, tap GymGo > App Details and install the Watch
  app. Or, on the iPhone, open the Watch app > My Watch > scroll to Available
  Apps > GymGo > Install.

If a Watch install hangs: quit Xcode, restart the iPhone and the Watch,
plug the iPhone back in, and try again.

### 9.7 The test lists (You)

Phase 4:

- [ ] Start a session on the phone: the Watch app opens by itself.
- [ ] Press Done on the phone, lock the phone and pocket it. The Watch counts
      the rest down, taps your wrist once at the end, and shows the next set.
- [ ] Your heart rate shows on the Watch.

Phase 5:

- [ ] Log a whole session on the Watch with the phone locked in your bag: a
      superset, a pyramid, and something heavy enough to be a record. Use the
      Crown, Done, the Action button and a double tap.
- [ ] Open the phone: every set is there, with the right times and records,
      and it backs up.
- [ ] Log a set on the phone: the Watch keeps up.
- [ ] When the Watch is running the session, a rest ends with **one** tap on
      the wrist, not a tap and a phone notification.

## Part 10: Phase 6, Apple Health

### 10.1 What Claude does

- Saves every finished workout to Apple Health as Traditional Strength
  Training, with your heart rate and calories. With the Watch, the Watch saves
  it, so your Activity rings count it; without the Watch, the phone saves it.
  Never twice.
- Reads your body weight from Apple Health into Progress > Body when the app
  opens. A weight you typed into GymGo is never overwritten.
- Adds two switches in Settings: one to save workouts, one to read your weight.
- Writes a short privacy policy (Apple requires one for any app using
  Health).

### 10.2 Permissions (You)

- [ ] When GymGo asks for Health access, allow **Workouts** (to save) and
      **Body Weight** (to read). On iOS 27, choose **all** of your history if
      you want your past weigh-ins in GymGo.
- [ ] To change it later: Settings > Privacy & Security > Health > GymGo.

Apple never tells an app that you said no. If you refuse body weight, GymGo
just sees nothing, so it will say so and point you to that setting.

### 10.3 The test list (You)

- [ ] Finish a session: it appears once in the Health app and the Fitness app,
      with heart rate.
- [ ] Weigh yourself on scales that write to Apple Health (or add a weight in
      the Health app). Open GymGo: it appears in Progress > Body.

## Part 11: Before you rely on a build

Run this short list on a new build before taking it to the gym:

- [ ] Cold start in aeroplane mode, and log a set.
- [ ] A rest that ends with the phone locked: it buzzes.
- [ ] A few sets logged on the Watch with the phone in a bag, then the phone
      opened: they are all there.
- [ ] Close the app mid-rest and reopen: the rest is still counting.
- [ ] Settings shows **Backed up**.

## Part 12: When something goes wrong

| What you see | What it means and what to do |
|---|---|
| A team called "(Personal Team)" | That is the free team. Pick the one with just your name |
| Red error under Signing | Copy the text to Claude. Usually the wrong team or bundle ID |
| Developer Mode isn't in Settings | Start pairing in Device Hub first (plug in, Trust); the switch appears after |
| iPhone or Watch stuck "preparing" or not available | Wait a few minutes. Then restart the device, plug the iPhone back in, try again |
| Watch install hangs | Quit Xcode, restart both devices, plug the iPhone in, try again. Or install through TestFlight |
| The devices vanished from Device Hub after an iOS update | Pair them again. Every OS update needs it |
| Upload fails with "PLA Update available" | Accept the agreement (2.4), wait a few minutes, try again |
| A build says "Missing Compliance" in TestFlight | Click Manage, answer that the app only uses standard encryption (HTTPS). Claude's setting stops this happening again |
| App Store Connect says the name is taken | Try a variant. The home-screen name stays GymGo |
| TestFlight says the build expired | Start a build in Xcode Cloud (Manual Start). The weekly build should prevent this |
| Xcode offers to convert the project to a new format | Say no. It breaks Capacitor |
| One unit test fails just after midnight | A clock quirk Phase 0 fixes. Until then, run it again after 1am |
| Teleport fails | See 3.2 |
| The app opens empty after an iOS update or a full phone | Settings > Backup, sign in: it restores. Or the app offers to restore its own snapshot |
| Anything else | Copy the exact message, or describe the screen, and give it to Claude |

## Part 13: Words you will meet

| Word | What it means here |
|---|---|
| **Xcode** | Apple's app for building iPhone and Watch apps. Claude drives it from the command line; you use its windows for a few one-off settings. |
| **Device Hub** | Xcode 27's window for your simulators and real devices. Open it with Manage Devices… in the device menu. |
| **Project** | The Xcode file that describes the app: `ios/App/App.xcodeproj`. |
| **Target** | One thing the project builds. GymGo will have three: the iPhone app (App), the Watch app, and the widget extension for the Lock Screen countdown. |
| **Scheme** | Which target the Run button runs. Picked on the left of the toolbar's middle section. |
| **Bundle ID** | The app's permanent name inside Apple's systems, like `com.liamdaly.gymgo`. Fixed for good after the first upload. |
| **Team** | Your Apple Developer account, as Xcode sees it. Every target is signed by your team. |
| **Signing** | Apple's proof that an app came from you. Xcode does it automatically once you pick your team. |
| **Capability** | A permission the app asks Apple for, such as HealthKit or App Groups. Switched on in the Signing & Capabilities tab. |
| **Simulator** | A pretend iPhone or Watch on the Mac. Good for most checks; Health and the phone-to-Watch link need the real devices. |
| **Developer Mode** | A switch on the iPhone and the Watch that lets them run apps straight from Xcode. |
| **Branch** | A named line of work in git. `main` is what goes to your phone; Claude works on `dev`. |
| **Capacitor** | The tool that puts the existing web app inside a real iPhone app. |
| **Web view** | The part of the iPhone app that shows the web app. It uses the same engine as Safari. |
| **Plugin** | A small piece of Swift that lets the web app use something only an app can (vibration, files, the Watch, Health). |
| **App Group** | A folder shared by the iPhone app and its Lock Screen widget. It does not reach the Watch, which is a separate device. |
| **Archive** | A finished build, ready to send to Apple. |
| **App Store Connect** | Apple's website where the app's record and TestFlight live. Nothing there is public unless you submit it for review, which you never will. |
| **TestFlight** | Apple's app for installing test builds. You are the only tester. Each build lasts 90 days. |
| **Xcode Cloud** | Apple's build service. It builds the app from GitHub and sends it to TestFlight without your Mac. |
| **Live Activity** | The countdown on the Lock Screen and in the Dynamic Island. |
| **HealthKit** | Apple Health, as an app talks to it. |
| **Workout session** | What tells the Watch a workout is running. It keeps GymGo on your wrist and reads your heart rate. |
| **Teleport** | Moving a cloud Claude Code chat onto your Mac, conversation included. |
