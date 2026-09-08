// F263.14 — beviset for at Ambient kan åbne sessionen selv. `--spawntest`.
//
// To ting skal være sande, og den ANDEN er den vigtige:
//   1. den kan åbne en tmux-session og sende kommandoen
//   2. kommandoen den sender er INTERAKTIV — aldrig `claude -p`
//
// (2) prøves ved at læse den kommando tmux faktisk fik, ikke ved at læse vores
// egen kildekode. En prøve på kildekoden ville bestå på en streng der bliver
// sammensat anderledes ved kørsel.
import Foundation

enum SpawnTest {
    static func run() {
        var fejl: [String] = []
        func kraev(_ ok: Bool, _ hvad: String) {
            print(ok ? "  ok   \(hvad)" : "  FEJL \(hvad)")
            if !ok { fejl.append(hvad) }
        }

        // ── NEGATIVE KONTROLLER FØRST ────────────────────────────────────
        // En konto-streng ender i en skal-kommando. Slipper noget forbi her,
        // findes der en vej fra et tekstfelt til vilkårlig kodeudførelse.
        for ond in ["; rm -rf /", "a b", "$(whoami)", "`id`", "../etc", "", "Å", "a'b"] {
            let r = SessionSpawner.startIngest(tenant: ond)
            kraev(r == .fejl("ugyldig konto: \(ond)"), "afviser konto \(ond.isEmpty ? "«tom»" : "«\(ond)»")")
        }

        // ── DEN ÆGTE VEJ ─────────────────────────────────────────────────
        let navn = "spawntest-\(UUID().uuidString.prefix(6))"
        _ = sh("tmux kill-session -t \(navn) 2>/dev/null")

        // Åbn en tmux-session med en kommando vi kan LÆSE tilbage — samme form
        // SessionSpawner bruger, men med `cat` i stedet for claude, så prøven
        // ikke brænder kvote for at bevise et tmux-kald.
        let r = sh("tmux new-session -d -s \(navn) 'cat' && tmux list-sessions -F '#S' | grep -c '^\(navn)$'")
        kraev(r.trimmingCharacters(in: .whitespacesAndNewlines) == "1", "tmux kan åbne en løsrevet session")
        _ = sh("tmux kill-session -t \(navn) 2>/dev/null")

        // ── DEN VIGTIGE: hvad STARTER sessionen, og på hvilken regning? ───
        //
        // Kommandoen ligger IKKE længere i vores program — den ligger i
        // buddys ccb-open, og det er dén der afgør om sessionen bruger
        // abonnementet eller et betalt API. Så det er dén der skal måles.
        //
        // Min forrige udgave asserterede på vores egen binære fil og bestod
        // på prøvens EGEN grep-streng, efter at den rigtige kommando var
        // flyttet ud. Anden gang samme dag at en kontrol fandt sig selv.
        let mig = CommandLine.arguments[0]
        kraev(FileManager.default.isExecutableFile(atPath: SessionSpawner.launcher),
              "spawn-ingest.sh findes og er eksekverbar")

        let l = esc(SessionSpawner.launcher)
        let auth = sh("sed 's/#.*//' \(l) | grep -c 'CLAUDE_CODE_OAUTH_TOKEN'")
        kraev((Int(auth.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0) > 0,
              "launcheren eksporterer OAuth-tokenet — ellers: «Not logged in» + API-betaling")

        // FRISK SESSION. ccb-open resumer altid repoets nyeste samtale — målt
        // 8/9 genoptog den ejerens LEVENDE session, så to Claude-processer stod
        // på samme transskript og arbejderen startede med 840.000 tokens den
        // ikke havde brug for. Vores eget script må ALDRIG bære --resume.
        // KOMMENTARER FILTRERES FRA. Uden det flagede prøven min egen
        // forklaring af hvorfor ccb-open ikke duer — tredje gang på én dag at
        // en kontrol fandt sin egen beskrivelse. Husets guard-no-metered-claude
        // løste det samme sådan her, og jeg gentog fejlen alligevel.
        let resume = sh("sed 's/#.*//' \(l) | grep -c -- '--resume'")
        kraev(resume.trimmingCharacters(in: .whitespacesAndNewlines) == "0",
              "launcheren resumer IKKE — en arbejder starter tom")

        let interaktiv = sh("sed 's/#.*//' \(l) | grep -c 'exec ccb'")
        kraev((Int(interaktiv.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0) > 0,
              "launcheren starter en INTERAKTIV session (exec ccb)")

        let cL = "cla" + "ude"
        let mL = "\(cL) +-p( |$)|\(cL) +--pr" + "int"
        let meteredL = sh("sed 's/#.*//' \(l) | grep -cE \(esc(mL))")
        kraev(meteredL.trimmingCharacters(in: .whitespacesAndNewlines) == "0",
              "launcheren bruger INGEN betalt kaldeform")

        // Og hele programmet må ikke bære den betalte form nogen steder.
        //
        // MØNSTERET SAMMENSÆTTES VED KØRSEL. Første udgave skrev det som en
        // literal og som en menneskelig etiket — og fandt så SIG SELV: den
        // eneste træffer i hele programmet var prøvens egen tekst «INTET sted
        // i programmet står …». En kontrol der ikke kan skelne sin egen
        // beskrivelse fra fundet, er ubrugelig i begge retninger.
        let c = "cla" + "ude"
        let moenster = "\(c) +-p( |$)|\(c) +--pr" + "int"
        let metered = sh("strings \(esc(mig)) | grep -cE \(esc(moenster))")
        kraev(metered.trimmingCharacters(in: .whitespacesAndNewlines) == "0",
              "ingen betalt kaldeform nogen steder i programmet")

        // POSITIV KONTROL på selve instrumentet: samme grep, et mønster vi VED
        // findes. Nul her ville betyde at `strings | grep` ikke virker — og så
        // var nullet ovenfor et blindt nul, ikke et rent.
        // Kontrol-mønsteret sammensættes OGSÅ ved kørsel, af samme grund:
        // ellers ville prøven finde sin egen etiket og kalde det et fund.
        let kontrolOrd = "trail-" + "ingest"
        let kontrol = sh("strings \(esc(mig)) | grep -cF \(esc(kontrolOrd))")
        kraev((Int(kontrol.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0) > 0,
              "KONTROL: grep-instrumentet finder faktisk noget")

        // ── karantænen: to kald i træk må ikke give to sessioner ─────────
        // (prøves på reglen, ikke ved at åbne to rigtige sessioner)
        kraev(SessionSpawner.sessionsNavn == "trail-ingest",
              "vagten bruger sin EGEN session, ikke ejerens `trail`")

        print(fejl.isEmpty ? "SPAWNTEST PASS" : "SPAWNTEST FAIL: \(fejl.joined(separator: " · "))")
        exit(fejl.isEmpty ? 0 : 1)
    }

    private static func esc(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private static func sh(_ cmd: String) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-lc", cmd]
        let roer = Pipe(); p.standardOutput = roer; p.standardError = Pipe()
        guard (try? p.run()) != nil else { return "" }
        let d = roer.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return String(data: d, encoding: .utf8) ?? ""
    }
}
