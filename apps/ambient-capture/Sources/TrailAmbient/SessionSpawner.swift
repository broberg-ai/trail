// F263.14 — Ambient åbner selv sessionen. buddy er ude af den lokale vej.
//
// Ejeren 8/9: «Ellers giver Ambient jo ikke mening, så er det jo bedre med den
// web server vi anvendte før, for den virkede da altid.»
//
// Han har ret. Kæden var tre led — Ambient ser arbejdet, buddy vækker
// sessionen, sessionen kompilerer — og midterled var en dæmon der fryser når
// maskinen er presset. Målt samme dag: buddy KØRTE (pid 62252) og svarede ikke
// på fem kald i træk, med 89 % swap. Den samme kilde strandede to gange.
//
// Nu: Ambient ser arbejdet → Ambient åbner sessionen → sessionen kompilerer.
// buddy bruges kun til det den er god til, at tale mellem repoer.
//
// ALDRIG `claude -p`. Sessionen er INTERAKTIV i en løsrevet tmux — samme form
// buddys egen host-relaunch bruger (apps/server/src/host-relaunch.ts:31):
//
//     tmux new-session -d -s <navn> "cd <repo> && claude …"
//
// En interaktiv session på Max-abonnementet koster 0. En `-p`-underproces er
// API-betalt og ville ophæve hele grunden til at F263 findes. Spærren
// scripts/guard-no-metered-claude.sh skanner denne fil som alle andre.
//
// INGEN AppKit-import: løkken skal kunne køre på en maskine uden skærm.
import Foundation

enum SpawnUdfald: Equatable {
    /// Sessionen fandtes; kommandoen blev sendt til den.
    case sendtTilEksisterende(String)
    /// Ny tmux-session åbnet og kommandoen sendt.
    case startet(String)
    case fejl(String)

    var erOk: Bool { if case .fejl = self { return false }; return true }
}

enum SessionSpawner {
    /// Repoet der skal åbnes. Ét sted, og kan overstyres uden en ny udgivelse —
    /// en absolut sti hørte ikke hjemme spredt i koden, men den skal stå ét
    /// sted, for appen ER dette repos app.
    static var repoSti: String {
        UserDefaults.standard.string(forKey: "trail.repoPath")
            ?? "\(NSHomeDirectory())/Apps/broberg/trail"
    }

    /// Buddys launcher. En SKAL-FIL på disken — ikke dæmonen. Kører den ikke,
    /// er filen der stadig, og det er hele grunden til at afhængigheden af at
    /// buddy SVARER er væk selv om vi bruger buddys script.
    static var launcher: String { "\(repoSti)/apps/ambient-capture/scripts/spawn-ingest.sh" }

    /// EGEN session, ikke ejerens. Sendte vi ind i hans åbne `trail`-session,
    /// ville en baggrunds-kompilering afbryde det han sad med.
    static let sessionsNavn = "trail-ingest"

    /// Kør en kommando og få både udfald og output — `try?` ville gøre «tmux
    /// findes ikke» og «sessionen findes ikke» til samme tavse nil.
    private static func sh(_ argv: [String]) -> (kode: Int32, ud: String) {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-lc", argv.joined(separator: " ")]
        let roer = Pipe()
        p.standardOutput = roer
        p.standardError = roer
        do { try p.run() } catch { return (127, "kunne ikke starte bash: \(error.localizedDescription)") }
        let data = roer.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return (p.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }

    private static func tmuxFindes() -> Bool { sh(["command", "-v", "tmux"]).kode == 0 }

    static func sessionKoerer(_ navn: String = sessionsNavn) -> Bool {
        sh(["tmux", "has-session", "-t", esc(navn), "2>/dev/null"]).kode == 0
    }

    /// Sæt en lokal kompilering i gang for én konto.
    ///
    /// Findes sessionen, sendes kommandoen bare derind — at åbne en til ville
    /// give to arbejdere om samme kø. F263.1's lease gør det ufarligt, men to
    /// sessioner der brænder kvote på det samme er stadig spild.
    @discardableResult
    static func startIngest(tenant: String) -> SpawnUdfald {
        let rent = tenant.trimmingCharacters(in: .whitespacesAndNewlines)
        // Kontoen ender i en skal-kommando. Kun det tegnsæt en slug kan have —
        // alt andet afvises frem for at blive citeret væk, så der ikke findes
        // en vej fra et felt til en kommando.
        guard !rent.isEmpty, rent.range(of: "^[a-z0-9-]{1,64}$", options: .regularExpression) != nil
        else { return .fejl("ugyldig konto: \(tenant)") }
        guard tmuxFindes() else { return .fejl("tmux findes ikke på maskinen") }

        let kommando = "/local-ingest \(rent)"

        if sessionKoerer() {
            let r = sh(["tmux", "send-keys", "-t", esc(sessionsNavn), esc(kommando), "Enter"])
            return r.kode == 0
                ? .sendtTilEksisterende(sessionsNavn)
                : .fejl("kunne ikke sende til sessionen: \(r.ud.prefix(160))")
        }

        // BRUG BUDDYS EGEN LAUNCHER — ikke vores egen tmux-kommando.
        //
        // Første udgave kaldte `tmux new-session -d … claude` direkte. Den
        // ÅBNEDE en session (35 sekunder efter en kilde blev parkeret, målt),
        // og sessionen var ubrugelig:
        //
        //     Opus 5 with xhigh effort · API Usage Billing
        //     ❯ /local-ingest broberg-ai
        //       ⎿  Not logged in · Please run /login
        //
        // To fejl på én linje, og den anden er den dyre: ingen auth, OG
        // API-betaling i stedet for abonnementet. Præcis den fælde flådens
        // regel om navngivne teammate-agenter allerede beskriver — «de arver
        // ikke sessionens login, og en af dem stod på API Usage Billing».
        //
        // ccb-open gør de to ting vi manglede, og den er en SKAL-FIL, ikke en
        // dæmon — så afhængigheden af at buddy SVARER er stadig væk:
        //   · eksporterer CLAUDE_CODE_OAUTH_TOKEN fra ~/.buddy/.env
        //   · sætter PATH (bash -lc rammer ~/.bashrc's tidlige return)
        //   · genoptager repoets nyeste samtale, så sessionen har kontekst
        //   · afviser selv at åbne nummer to med samme navn
        guard FileManager.default.isExecutableFile(atPath: launcher) else {
            return .fejl("ccb-open findes ikke på \(launcher) — kan ikke åbne en session med login")
        }
        let r = sh([esc(launcher), esc(repoSti), esc(sessionsNavn), esc(rent)])
        guard r.kode == 0 else { return .fejl("spawn-ingest fejlede: \(r.ud.prefix(160))") }

        // Claude skal have læst sin opsætning før den kan tage imod. Sender vi
        // for tidligt, forsvinder tasterne i opstarten — og så sker der
        // INGENTING, tavst, hvilket er den fejlform vi bruger dagen på.
        // Scriptet sender selv kommandoen efter opstarten (to Enter mod en
        // eventuel tillids-prompt, så kommandoen). Sendte vi også herfra,
        // ville den blive kørt to gange.
        return .startet(sessionsNavn)
    }

    private static func esc(_ s: String) -> String {
        "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
