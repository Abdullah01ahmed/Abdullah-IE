# Hosting guide

Twin Rivers: Arena connects players directly to a game server by IP address.
That server is either the one the game starts for you when you click **Host**,
or a **dedicated server** you run from the command line. Both listen on one
**TCP** port — **27600** by default — and speak WebSocket, so hosting is the
same job as hosting any small TCP service: make sure the port is reachable.

Contents

1. [Hosting on a LAN](#1-hosting-on-a-lan)
2. [Finding your IP address](#2-finding-your-ip-address)
3. [Windows Defender Firewall](#3-windows-defender-firewall)
4. [Hosting over the internet: port forwarding](#4-hosting-over-the-internet-port-forwarding)
5. [Passwords](#5-passwords)
6. [Running a dedicated server](#6-running-a-dedicated-server)
7. [Keeping a dedicated server running](#7-keeping-a-dedicated-server-running)
8. [Troubleshooting by error](#8-troubleshooting-by-error)

## 1. Hosting on a LAN

1. Start the game, choose **Host**, give the room a name, keep port **27600**
   (or pick another free one), optionally set a password, choose bots and match
   rules, and start.
2. If Windows shows a firewall prompt for *Twin Rivers Arena*, tick **Private
   networks** and allow it. (Skip this if the installer already added the rule —
   see section 3.)
3. The host screen lists your LAN addresses, for example `192.168.1.20`.
   Tell the others to choose **Join** and enter that address (the port is only
   needed if you changed it: `192.168.1.20:27601`).
4. Everyone must be on the same network. Guest Wi-Fi networks and many
   corporate/hotel networks isolate clients from each other; a phone hotspot or
   a home router works.

## 2. Finding your IP address

**LAN address (for players on your network)** — the host screen shows it.
Otherwise:

- Windows: `ipconfig` → *IPv4 Address* of the adapter you are using
  (`192.168.x.x`, `10.x.x.x` or `172.16–31.x.x`).
- Linux/macOS: `ip addr` or `ifconfig`.

**Public address (for players on the internet)** — this is the address of your
router, not of your PC. Open <https://ifconfig.me> or <https://api.ipify.org>
in a browser, or run `curl ifconfig.me`. Most home connections change this
address every few days; check it each time you host, or use a dynamic-DNS
hostname (players can enter `yourname.example.net:27600`).

If your ISP uses carrier-grade NAT (the public address the router reports
starts with `100.64`–`100.127`, or differs from what ifconfig.me shows), port
forwarding will not work; ask the ISP for a public IPv4 address, or use a VPN /
tunnelling service that gives you one, or host on a rented server (section 6).

## 3. Windows Defender Firewall

Incoming connections to the port must be allowed on the **host** machine only.
Players who join never need firewall changes.

**The game (Host button).** The installer runs
`netsh advfirewall firewall add rule name="Twin Rivers Arena" dir=in action=allow program="<install dir>\Twin Rivers Arena.exe" enable=yes`
during installation. That needs administrator rights; a per-user install that
was not elevated cannot add the rule, in which case Windows prompts the first
time you host — allow it on *Private* networks. To add the rule yourself, in an
elevated PowerShell:

```powershell
netsh advfirewall firewall add rule name="Twin Rivers Arena" dir=in action=allow program="%LOCALAPPDATA%\Programs\Twin Rivers Arena\Twin Rivers Arena.exe" enable=yes
```

**A dedicated server** runs under `node.exe`, which has no rule. Either allow
the program or, better, just the port:

```powershell
netsh advfirewall firewall add rule name="Twin Rivers Arena server (TCP 27600)" dir=in action=allow protocol=TCP localport=27600
```

Remove a rule with `netsh advfirewall firewall delete rule name="<name>"`.
The uninstaller removes the game's rule.

Linux hosts: `sudo ufw allow 27600/tcp` (or the equivalent for firewalld /
nftables).

## 4. Hosting over the internet: port forwarding

Home routers block unsolicited incoming connections. You forward one port to
the hosting PC so that connections arriving at your public address on that port
reach the game.

What to forward: **protocol TCP, external port 27600, internal port 27600,
internal address = the LAN address of the hosting PC** (from section 2). If you
host on another port, forward that one instead. UDP is not used.

Step by step:

1. Give the hosting PC a stable LAN address. In the router's DHCP settings
   reserve its current address for its MAC address (often called *DHCP
   reservation* or *static lease*), or set a static IP on the PC. Without this
   the forward silently breaks when the PC gets a different address.
2. Open the router's admin page (usually <http://192.168.1.1> or
   <http://192.168.0.1>; the address is printed on the router or shown as
   *Default Gateway* in `ipconfig`) and log in.
3. Find *Port Forwarding* (also *Virtual Server*, *NAT*, *Applications &
   Gaming* or *Firewall → Port rules*).
4. Add a rule:
   - Name: `Twin Rivers Arena`
   - Protocol: `TCP`
   - External (WAN) port: `27600`
   - Internal (LAN) port: `27600`
   - Internal IP / device: the hosting PC's LAN address
   - Enabled: yes
5. Save / apply. Some routers need a reboot.
6. Start hosting in the game (the port is only reachable while a server is
   running), then verify from outside: a friend joins `<public IP>:27600`, or
   a port checker such as <https://www.yougetsignal.com/tools/open-ports/>
   reports the port open. Checking from inside your own network often fails
   even when the forward is correct (NAT loopback), so test from outside or
   from a phone on mobile data.

If your ISP's modem sits in front of your own router (double NAT), the rule has
to exist on both, or put the modem in bridge mode. UPnP is not used; the rule
must be created manually.

Share your **public** IP (section 2) with internet players and your **LAN** IP
with players in the house.

## 5. Passwords

A room password is optional. Set it on the host screen or with
`--password <text>` on a dedicated server; players enter it on the Join
screen. Passwords are compared by the server before a player is admitted
(`BAD_PASSWORD` reject otherwise) and are not stored in the settings file.
They travel inside the WebSocket connection, which is not encrypted, so use a
throwaway phrase, not a real password.

## 6. Running a dedicated server

The server is a single file that needs only Node.js 20+:

```bash
npm run build:server                       # produces packages/server/dist/server.cjs
node packages/server/dist/server.cjs --port 27600 --dedicated --bots fill --bot-difficulty hard
```

Copy `server.cjs` anywhere (a VPS, a NAS, a second PC) and run it with
`node server.cjs …`. Useful flags:

```
--port 27600            TCP port
--password secret       require a password
--name "Friday night"   name shown in the lobby
--dedicated             no lobby host; the server starts matches itself
--bots fill             fill empty slots with bots (none | fixed | fill)
--bots-tigris 2 --bots-euphrates 2      bot counts for --bots fixed
--bot-difficulty hard   easy | normal | hard | extreme
--score-limit 75 --time-limit 600 --respawn-delay 3
--friendly-fire false --replace-bots true
--log-level info        debug | info | warn | error | silent
```

Every flag also works as an environment variable with a `TRA_` prefix
(`TRA_PORT=27601 TRA_DEDICATED=1 node server.cjs`); flags win over variables.
`--help` prints the full list. On start the server logs
`TRA_SERVER_READY port=27600`; on a fatal start-up error it prints
`TRA_SERVER_ERROR code=<CODE> message=<text>` and exits with status 2.
`SIGINT`/`SIGTERM` shut it down cleanly.

A rented VPS has a public IP and no NAT, so no port forwarding is needed —
only its firewall / security group must allow inbound TCP 27600.

## 7. Keeping a dedicated server running

### Linux — systemd

`/etc/systemd/system/tra-server.service`:

```ini
[Unit]
Description=Twin Rivers: Arena dedicated server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tra
WorkingDirectory=/opt/tra
ExecStart=/usr/bin/node /opt/tra/server.cjs --dedicated --port 27600 --bots fill --bot-difficulty hard --name "Twin Rivers EU"
Environment=TRA_LOG_LEVEL=info
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin tra
sudo mkdir -p /opt/tra && sudo cp packages/server/dist/server.cjs /opt/tra/ && sudo chown -R tra:tra /opt/tra
sudo systemctl daemon-reload
sudo systemctl enable --now tra-server
journalctl -u tra-server -f          # logs
```

### Windows — Task Scheduler

1. Copy `server.cjs` to `C:\tra\server.cjs` and add the firewall rule from
   section 3 for TCP 27600.
2. Open **Task Scheduler → Create Task…**
   - *General*: name `Twin Rivers Arena server`; **Run whether user is logged
     on or not**; tick *Run with highest privileges* only if the firewall rule
     requires it (it does not).
   - *Triggers*: **At startup** (add a 30-second delay so the network is up).
   - *Actions*: **Start a program**
     - Program: `C:\Program Files\nodejs\node.exe`
     - Arguments: `C:\tra\server.cjs --dedicated --port 27600 --bots fill --bot-difficulty hard`
     - Start in: `C:\tra`
   - *Settings*: tick **If the task fails, restart every 1 minute**, and untick
     *Stop the task if it runs longer than*.
3. Right-click the task → **Run** to start it now. To see the log, run the same
   command in a terminal instead, or add `> C:\tra\server.log 2>&1` by using
   `cmd /c "node C:\tra\server.cjs … > C:\tra\server.log 2>&1"` as the action.

Or from an elevated PowerShell:

```powershell
$action  = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" -Argument "C:\tra\server.cjs --dedicated --port 27600 --bots fill --bot-difficulty hard" -WorkingDirectory "C:\tra"
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "Twin Rivers Arena server" -Action $action -Trigger $trigger -RunLevel Limited -User "SYSTEM"
```

## 8. Troubleshooting by error

| Message / code | Meaning | What to do |
| --- | --- | --- |
| **Port … is already in use** (`PORT_IN_USE`) | Something on the host already listens on that TCP port — often a server from a previous session that is still shutting down. | Pick another port on the host screen, or find the process (`netstat -ano \| findstr 27600`, then Task Manager → Details → PID) and close it. |
| **The server did not start within 10 seconds** / **exited before it was ready** (`SPAWN_FAILED`) | The embedded server process crashed or hung on start-up. | Read the log on the host screen. Reinstall if `server.cjs` is missing from the install folder (`resources\server\`). |
| **The server bundle is missing** (`NOT_AVAILABLE`) | Development build without `npm run build:server`, or a damaged install. | Run `npm run build:server` (dev) or reinstall the game. |
| **Hosting from inside the game requires the desktop app** | You clicked Host in a browser tab. | Use the Electron app (`npm run dev:desktop`), or run a dedicated server and join `127.0.0.1`. |
| **Could not connect to …** (`CONNECT_FAILED`) | TCP connection refused or reset: nothing is listening at that address/port, or a firewall actively rejected it. | Check the address and port, that the host's server is running (the host is in the lobby), and the host's firewall rule (section 3). |
| **No response from …** (`TIMEOUT`) | Packets are being dropped: wrong public IP, port not forwarded, router/ISP blocking, or a LAN that isolates clients. | LAN: same network, not a guest network. Internet: verify the public IP, the port-forward rule (section 4), double NAT, CGNAT. |
| **Enter an address like 192.168.1.20** (`INVALID_ADDRESS`) | The text is not `host` or `host:port`. | Remove `ws://`, spaces and paths; the port must be 1–65535. |
| **The server is full (10 players)** (`SERVER_FULL`) | All ten slots are taken by humans or bots that cannot be replaced. | Wait for a slot, or have the host enable *replace bots with humans* / remove a bot. |
| **That team is full** (`TEAM_FULL`) | The chosen team already has five players. | Pick the other team or *auto*. |
| **Incorrect room password** (`BAD_PASSWORD`) | Password mismatch (case-sensitive). | Ask the host. |
| **Your game version does not match the server** (`VERSION_MISMATCH`) | Different builds on the two ends. | Update both to the same version; dedicated servers must be rebuilt from the same source. |
| **That player name is already in use** (`NAME_TAKEN`) | Someone in the room has that name (or your own previous session is still in its 30 s reconnect grace). | Choose another name, or wait 30 s and rejoin with the same name to resume. |
| **Player name must be 1–20 characters** (`INVALID_NAME`) | Empty or too long. | Shorten it. |
| **You were removed from the match by the host** (`KICKED`) | The host kicked you. | — |
| **Too many messages; slow down** (`RATE_LIMITED`) | The client sent more messages than allowed. | Usually a bug or a flaky connection; rejoin. |
| **The server shut down** (`SERVER_SHUTDOWN`) | The host left or the dedicated server stopped. | Ask the host to start again. |
| **Connection timed out** (`TIMEOUT`, in-match) | No traffic from the server for too long. | Check the connection; rejoin with the same name within 30 s to keep your slot. |

Still stuck? Start a dedicated server with `--log-level debug` and join it
from the same machine with `127.0.0.1`: if that works the game is fine and the
problem is purely network reachability (sections 3 and 4).
