// F263.8 — reglen for hvad statuslinjen siger om HVEM der kompilerer.
//
// Den bor her og ikke inde i View'et af én grund: det er reglen der kan være
// forkert, og en regel ingen kan prøve er præcis det der lod «Skyen kompilerer»
// stå som svaret på «ved ikke» i et døgn.
//
// Ejerens indvending 8/9 — «hvorfor skal du anvende buddy for at vi kan lave
// lokal ingest & compile?» — er hele grunden til at funktionen findes:
//
//   MÅLINGEN (Trails eget API) slår INDSTILLINGEN (buddys job-flag). Altid.
//
// buddy er ægte nødvendig til ÉN ting: at vække cc-sessionen, som ikke kan
// vække sig selv. Den skal ikke også være svaret på hvad der sker lige nu —
// `workers` er dem der FAKTISK har taget arbejde, og det er et stærkere svar
// end et flag der beskriver hvad der burde ske.
import Foundation

enum Motorlinje {
    /// Hvad MÅLINGEN siger, eller nil når der intet er at måle (så falder
    /// fladen tilbage på buddys indstilling — og kun der).
    ///
    /// `vaert` er denne maskines navn som det står i et claim. Er det os,
    /// siger vi «Denne Mac kompilerer»; er det en anden, NAVNGIVER vi den
    /// frem for at lade brugeren tro det er hans egen.
    static func maalt(_ status: CompileStatus, vaert: String) -> String? {
        if let w = status.workers.first {
            return w == vaert ? S.engineOn : "\(S.ingestCompiledOn) \(w)"
        }
        // Venter der arbejde uden at nogen har taget det, er DET svaret —
        // ikke hvad der er slået til. «Der ligger noget og ingen tog det» er
        // den tilstand man skal kunne se; den er usynlig i et flag.
        if status.waiting > 0 { return "\(status.waiting) \(S.ingestWaitingForEngine)" }
        return nil
    }
}
