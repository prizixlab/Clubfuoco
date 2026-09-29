import Foundation

// Pairs are lifted from the Swift runSelfChecks plus the web's
// venue-match.test.ts, so the corpus already encodes every regression the
// matcher was written to fix.
let pairs: [[String]] = [
    ["Razzmatazz", "Razzmatazz"], ["Macarena Club", "Macarena Club"],
    ["Sala Apolo", "sala  apolo!"], ["Montjuïc", "Montjuic"],
    ["", "Razzmatazz"], ["Razzmatazz", ""],
    ["Otto Zutz Barcelona", "Otto Zutz Club"], ["Sala Apolo Nitsa", "Apolo Nitsa Club"],
    ["City Hall", "Disco City Hall"], ["Razzmatazz", "Razzmatazz sales 2 & 3"],
    ["Input", "Input High Fidelity Dance Club"], ["Opium", "Opium Barcelona Restaurant"],
    ["Apolo", "Sala Apolo"], ["Sala Apolo", "Apolo"], ["Moog", "Moog Bar"],
    ["TBA - Backstage - Carrer Casp, 33", "Backstage"],
    ["Bling Bling Barcelona", "Bling Bling Nightclub"],
    ["Azul Rooftop Barceloneta", "Skygarden Barcelona Rooftop"],
    ["Azul Rooftop Barceloneta", "Azimuth Rooftop Bar"],
    ["Almar Beach Club", "El Kabron Beach Club"],
    ["Casa Montjuïc", "Casa Amirall"], ["City Hall", "Bar Hot Dog City"],
    ["Hola Club Sitges (Cala Vallcarca)", "La Cala"],
    ["Azul Rooftop Barceloneta", "Lolita Barceloneta"],
    ["Garage 442", "Garage Beer Co"], ["Teatre Grec", "Bar Teatre"],
    ["TBA - Backstage - Carrer Casp, 33", "El 9 Carrer"],
    ["Parc Nou. El Prat de Llobregat", "Bar Llobregat"],
    ["Sunseabar Beach Club", "Go Beach Club Barcelona"],
    ["Azul Rooftop Barceloneta", "Azul Frida"],
    ["Sutton Barcelona Lisboa", "Sutton Madrid Porto"],
    ["Beach Club", "beach club"], ["Beach Club", "Rooftop Bar"],
    // Live-corpus shapes the feed actually sees.
    ["Pacha Barcelona", "Pacha"], ["Shôko", "Shoko Barcelona"],
    ["La Terrrazza", "Terrazza"], ["Opium Barcelona", "Opium Mar"],
    ["Jamboree", "Jamboree Jazz Club"], ["Twenties", "Twenties Barcelona"],
    ["CDLC", "Carpe Diem Lounge Club"], ["Sutton", "Sutton The Club"],
]

struct Vector: Encodable { let a: String; let b: String; let match: Bool }
let vectors = pairs.map { Vector(a: $0[0], b: $0[1], match: VenueMatch.matches($0[0], $0[1])) }
FileHandle.standardOutput.write(try! JSONEncoder().encode(vectors))
