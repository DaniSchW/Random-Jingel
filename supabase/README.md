# Supabase-Setup für Random Jingle (Phase 2)

## 1. Projekt anlegen
Auf [supabase.com](https://supabase.com) ein neues Projekt anlegen (kostenloser Tier reicht).

## 2. Datenbank & Storage einrichten
Im Supabase-Dashboard unter **SQL Editor** den Inhalt von `supabase/schema.sql`
einfügen und ausführen. Legt an:
- Tabellen `categories`, `jingles` inkl. Row Level Security (jeder Nutzer sieht
  nur eigene Zeilen)
- Realtime-Publikation für beide Tabellen (für Live-Sync zwischen Geräten/Tabs)
- Privaten Storage-Bucket `jingle-audio` inkl. Policies (jeder Nutzer nur
  eigener Ordner `<user_id>/...`)

Das Skript ist idempotent, kann also gefahrlos erneut ausgeführt werden.

## 3. Auth: Magic Link
Unter **Authentication -> Providers** ist "Email" standardmäßig aktiv, das
reicht für Magic Links (kein Passwort nötig). Empfohlen:
- **Authentication -> Providers -> Email -> "Confirm email"**: aktiviert lassen.
- **Authentication -> URL Configuration**:
  - **Site URL**: die URL, unter der die App später erreichbar ist
    (z. B. `http://localhost:8080` während der Entwicklung).
  - **Redirect URLs**: dieselbe URL (und ggf. weitere, z. B. die Produktions-URL)
    hinzufügen — sonst schlägt der Magic-Link-Redirect fehl.

## 4. Projekt-Zugangsdaten eintragen
Unter **Project Settings -> API**:
- **Project URL** -> `SUPABASE_URL`
- **anon public key** -> `SUPABASE_ANON_KEY`

Beide Werte in `.env` eintragen (siehe `.env.example`), danach:

```bash
npm run config
```

Das generiert `js/config.js`, das `index.html` lädt. Ohne diese Datei läuft
die App weiterhin normal, aber rein lokal ohne Cloud-Funktionen (siehe
Haupt-README).

## Hinweise
- Der anon key ist bewusst öffentlich im Client-Code sichtbar — Schutz kommt
  ausschließlich über Row Level Security, nicht über Geheimhaltung des Keys.
- `updated_at` wird clientseitig gesetzt (Geräte-Uhrzeit) und ist die
  Grundlage für die Last-Write-Wins-Konfliktlösung. Bei stark abweichenden
  Systemuhren zwischen Geräten kann das in Einzelfällen zu falsch aufgelösten
  Konflikten führen — für Phase 2 als bekannte Einschränkung akzeptiert.
