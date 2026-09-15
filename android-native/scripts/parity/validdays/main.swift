import Foundation

// Golden-vector generator. Compiled TOGETHER with the real iOS source file, so
// the vectors are produced by the shipping implementation rather than by a
// re-description of it. That is the whole point: a hand-written expectation can
// agree with a hand-written port and both be wrong.

let corpus: [String] = [
    // Canonical forms the promoter day-picker writes.
    "Every night", "every night", "EVERY NIGHT", "every night!",
    "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    "Mon, Tue, Sun", "Tue, Wed, Sun", "Thu, Fri", "Mon, Tue, Wed, Sun",
    // Legacy free-form.
    "Any night", "Daily", "All week", "7 nights", "Weekends", "Weekdays",
    "Fridays & Saturdays", "Fridays and Saturdays", "Fri & Sat", "Fri/Sat",
    "Fri + Sat", "Fri; Sat",
    // Ranges, every dash the grammar accepts, including wrapping.
    "Thu - Sun", "Thu – Sun", "Thu — Sun", "Thursday — Sunday",
    "Fri to Sat", "Fri through Sun", "Fri thru Sun",
    "Sat - Mon", "Sun - Fri", "Sun – Fri", "Mon-Wed, Fri",
    "Tue, Thu – Sun", "Thu – Sat",
    // Full names and plurals.
    "Tuesdays", "Thursdays", "Monday", "saturday",
    // Junk / edge.
    "", "   ", "closed", "Closed for renovation", "n/a", "-", "–",
    "Mon-", "-Fri", "Mon - ", "Funday", "Sunset sessions",
    // Whitespace and casing noise.
    "  Fri  ,  Sat  ", "MON, TUE", "mon,tue,wed",
    // ADVERSARIAL: segments that START with a late-order day and also CONTAIN
    // an earlier-order one. These are the only inputs that distinguish
    // "prefix wins" from "first substring wins", and without them a port that
    // gets dayIndex backwards passes the whole suite. Found by mutation-testing
    // the Kotlin port, not by reading the Swift.
    "Sat night sundowners", "satsun", "frimon", "Thursday sunset set",
    "Fridays, Saturday sundown", "wednesday sunrise", "sat sun",
    "Saturday and Sunday", "Sat & Sun",
]

struct Vector: Encodable { let input: String; let days: [Int] }

let vectors = corpus.map { Vector(input: $0, days: ValidDays.parse($0).sorted()) }
let data = try! JSONEncoder().encode(vectors)
FileHandle.standardOutput.write(data)
