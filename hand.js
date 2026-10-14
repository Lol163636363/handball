export default {
  async fetch(request) {
    const urlSeniors = "https://www.ffhandball.fr/competitions/saison-2026-2027-22/departemental/excellence-masculine-32375/poule-192676";
    const urlU18 = "https://www.ffhandball.fr/competitions/saison-2026-2027-22/departemental/u18-masculins-32376/poule-192820";

    const decodeHtmlEntities = (value) => String(value)
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

    const hasScore = (value) => value !== undefined
      && value !== null
      && String(value).trim() !== ''
      && String(value).trim() !== '-';

    const formatDate = (value) => {
      if (!value) return 'Dernier match';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);

      const formatted = new Intl.DateTimeFormat('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Paris'
      }).format(date);
      return formatted.replace(/^(\d+\s+)(.)/, (_, prefix, initial) => prefix + initial.toUpperCase());
    };

    const formatTime = (value, dateValue) => {
      if (value) {
        const time = String(value).trim();
        const match = time.match(/^(\d{1,2})\s*[:hH]\s*(\d{2})$/);
        return match ? `${match[1].padStart(2, '0')}H${match[2]}` : time;
      }

      const date = new Date(dateValue);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Europe/Paris'
      }).format(date).replace(':', 'H');
    };

    const getMatchObjects = (html) => {
      const matches = [];
      const seen = new Set();

      const collect = (value) => {
        if (!value || typeof value !== 'object' || seen.has(value)) return;
        seen.add(value);

        if (Array.isArray(value)) {
          for (const item of value) collect(item);
          return;
        }

        const team1 = value.equipe1Libelle || value.equipe1Nom || value.equipeDomLibelle || value.equipeDom || value.equipe1;
        const team2 = value.equipe2Libelle || value.equipe2Nom || value.equipeExtLibelle || value.equipeExt || value.equipe2;
        if (typeof team1 === 'string' && typeof team2 === 'string') matches.push(value);

        for (const key of Object.keys(value)) collect(value[key]);
      };

      // Ancienne version du site : données Next.js sérialisées dans un script.
      const nextData = html.match(/<script[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (nextData && nextData[1]) {
        try {
          collect(JSON.parse(nextData[1]));
        } catch (_) {
          
        }
      }

      // Format actuel FFHandball : les rencontres sont dans l'attribut JSON
      // d'un composant Smartfire, avec les guillemets encodés en HTML.
      const componentTags = html.match(/<smartfire-component\b[^>]*>/gi) || [];
      for (const tag of componentTags) {
        if (!/\bname=['"]competitions---rencontre-list['"]/i.test(tag)) continue;

        const attributes = tag.match(/\battributes=(?:"([^"]*)"|'([^']*)')/i);
        if (!attributes) continue;

        try {
          const componentData = JSON.parse(decodeHtmlEntities(attributes[1] || attributes[2] || ''));
          if (Array.isArray(componentData.rencontres)) collect(componentData.rencontres);
        } catch (_) {
          // Une réponse dont le format est invalide déclenchera le fallback.
        }
      }

      return matches;
    };

    const getCompetitionMetadata = (html) => {
      const componentTags = html.match(/<smartfire-component\b[^>]*>/gi) || [];

      for (const tag of componentTags) {
        if (!/\bname=['"]competitions---rencontre-list['"]/i.test(tag)) continue;
        const attributes = tag.match(/\battributes=(?:"([^"]*)"|'([^']*)')/i);
        if (!attributes) continue;

        try {
          const data = JSON.parse(decodeHtmlEntities(attributes[1] || attributes[2] || ''));
          const rawJournees = data.poule && data.poule.journees;
          const journees = Array.isArray(rawJournees)
            ? rawJournees
            : JSON.parse(rawJournees || '[]');

          return {
            selectedJournee: Number(data.selected_numero_journee),
            journees: Array.isArray(journees) ? journees : []
          };
        } catch (_) {
          return { selectedJournee: 0, journees: [] };
        }
      }

      return { selectedJournee: 0, journees: [] };
    };

    const toMatchCard = (match, leagueName) => {
      const equipeLocale = match.equipe1Libelle || match.equipe1Nom || match.equipeDomLibelle || match.equipeDom || match.equipe1;
      const equipeVisiteur = match.equipe2Libelle || match.equipe2Nom || match.equipeExtLibelle || match.equipeExt || match.equipe2;
      const score1 = match.equipe1Score ?? match.scoreEquipe1 ?? match.score1 ?? match.scoreDom ?? match.scoreEquipeDom;
      const score2 = match.equipe2Score ?? match.scoreEquipe2 ?? match.score2 ?? match.scoreExt ?? match.scoreEquipeExt;
      const dateValue = match.dateRencontre || match.dateMatch || match.dateFormatted || match.date;

      return {
        league: leagueName,
        equipeLocale: equipeLocale.trim(),
        score1: hasScore(score1) ? String(score1) : '-',
        score2: hasScore(score2) ? String(score2) : '-',
        equipeVisiteur: equipeVisiteur.trim(),
        date: formatDate(dateValue),
        heure: formatTime(match.heureRencontre || match.heureMatch || match.heure, dateValue),
        estTermine: hasScore(score1) && hasScore(score2),
        domicile: equipeLocale.toUpperCase().includes('CERIZAY'),
        sortDate: Number.isNaN(new Date(dateValue).getTime()) ? 0 : new Date(dateValue).getTime()
      };
    };

    const cardWithoutSortDate = ({ sortDate, ...match }) => match;

    async function fetchCompetitionHtml(url) {
      let cache = null;
      let cacheKey = null;

      try {
        cache = typeof caches !== 'undefined' ? caches.default : null;
        cacheKey = cache ? new Request(url) : null;
        const cached = cacheKey ? await cache.match(cacheKey) : null;
        if (cached) return cached.text();
      } catch (_) {
        cache = null;
        cacheKey = null;
      }

      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      if (!res.ok) throw new Error(`FFHandball a répondu ${res.status}`);

      const html = await res.text();
      if (cache && cacheKey) {
        try {
          await cache.put(cacheKey, new Response(html, {
            headers: {
              'cache-control': 'public, max-age=3600',
              'content-type': 'text/html;charset=UTF-8'
            }
          }));
        } catch (_) {
          // Le cache est une optimisation : le rendu reste disponible sans lui.
        }
      }
      return html;
    }

    async function getDernierEtProchainMatch(url, leagueName, fallbackDernier, fallbackProchain) {
      try {
        const html = await fetchCompetitionHtml(url);
        const metadata = getCompetitionMetadata(html);
        const candidates = getMatchObjects(html)
          .map((match) => toMatchCard(match, leagueName))
          .filter((match) => (match.equipeLocale + ' ' + match.equipeVisiteur).toUpperCase().includes('CERIZAY'));

        const dernier = candidates
          .filter((match) => match.estTermine)
          .sort((a, b) => b.sortDate - a.sortDate)[0];

        let prochain = candidates
          .filter((match) => !match.estTermine)
          .sort((a, b) => a.sortDate - b.sortDate)[0];

        // La fédération affiche une journée à la fois. Si la journée affichée
        // est terminée, on ne consulte que la journée suivante du calendrier.
        if (!prochain && metadata.selectedJournee) {
          const prochaineJournee = metadata.journees
            .map((journee) => Number(journee.journee_numero))
            .filter((numero) => Number.isFinite(numero) && numero > metadata.selectedJournee)
            .sort((a, b) => a - b)[0];

          if (prochaineJournee) {
            const nextHtml = await fetchCompetitionHtml(`${url}/journee-${prochaineJournee}`);
            prochain = getMatchObjects(nextHtml)
              .map((match) => toMatchCard(match, leagueName))
              .filter((match) => (match.equipeLocale + ' ' + match.equipeVisiteur).toUpperCase().includes('CERIZAY'))
              .filter((match) => !match.estTermine)
              .sort((a, b) => a.sortDate - b.sortDate)[0];
          }
        }

        return {
          dernier: dernier ? cardWithoutSortDate(dernier) : fallbackDernier,
          prochain: prochain ? cardWithoutSortDate(prochain) : fallbackProchain
        };
      } catch (_) {
        return { dernier: fallbackDernier, prochain: fallbackProchain };
      }
    }

    const fallbackSeniors = {
      league: "Excellence Masculine",
      equipeLocale: "CERIZAY COC 1",
      score1: "17",
      score2: "35",
      equipeVisiteur: "COURLAY 2",
      date: "11 Octobre 2026",
      heure: "16H00",
      estTermine: true,
      domicile: true
    };

    const fallbackU18 = {
      league: "U18 Masculins",
      equipeLocale: "CERIZAY COC 1",
      score1: "21",
      score2: "37",
      equipeVisiteur: "NIORT HANDBALL SOUCHEEN 3",
      date: "11 Octobre 2026",
      heure: "14H00",
      estTermine: true,
      domicile: true
    };

    // Les journées précédentes sont conservées localement : la page FFHandball
    // ne renvoie qu'une journée par requête et plusieurs appels déclenchent son WAF.
    const historiquesSeniors = [
      {
        journee: 3,
        equipeLocale: "THOUARS UST HB 2",
        score1: "24",
        score2: "24",
        equipeVisiteur: "CERIZAY COC 1",
        date: "3 Octobre 2026",
        heure: "19H00"
      },
      {
        journee: 2,
        equipeLocale: "AIRVAULT FAT 1",
        score1: "33",
        score2: "20",
        equipeVisiteur: "CERIZAY COC 1",
        date: "26 Septembre 2026",
        heure: "21H00"
      },
      {
        journee: 1,
        equipeLocale: "CERIZAY COC 1",
        score1: "25",
        score2: "33",
        equipeVisiteur: "PRAHECQ HBC 3",
        date: "19 Septembre 2026",
        heure: "18H00"
      }
    ];

    const historiquesU18 = [
      {
        journee: 3,
        equipeLocale: "ENTENTE CHAURAY LA CRECHE HANDBALL 2",
        score1: "40",
        score2: "30",
        equipeVisiteur: "CERIZAY COC 1",
        date: "3 Octobre 2026",
        heure: "18H00"
      },
      {
        journee: 2,
        equipeLocale: "RT AVENIR BRIOUX-LEZAY U18M",
        score1: "39",
        score2: "24",
        equipeVisiteur: "CERIZAY COC 1",
        date: "26 Septembre 2026",
        heure: "17H00"
      },
      {
        journee: 1,
        equipeLocale: "CERIZAY COC 1",
        score1: "20",
        score2: "55",
        equipeVisiteur: "BRESSUIRE HBC1",
        date: "19 Septembre 2026",
        heure: "16H00"
      }
    ];

    // Secours si la fédération est temporairement indisponible.
    const fallbackProchains = [
      {
        league: "Excellence Masculine",
        equipeLocale: "MAULEON 1",
        score1: "-",
        score2: "-",
        equipeVisiteur: "CERIZAY COC 1",
        date: "31 Octobre 2026",
        heure: "21H00",
        estTermine: false,
        domicile: false
      },
      {
        league: "U18 Masculins",
        equipeLocale: "MAULEON 1",
        score1: "-",
        score2: "-",
        equipeVisiteur: "CERIZAY COC 1",
        date: "31 Octobre 2026",
        heure: "17H00",
        estTermine: false,
        domicile: false
      }
    ];

    const [donneesSeniors, donneesU18] = await Promise.all([
      getDernierEtProchainMatch(urlSeniors, "Excellence Masculine", fallbackSeniors, fallbackProchains[0]),
      getDernierEtProchainMatch(urlU18, "U18 Masculins", fallbackU18, fallbackProchains[1])
    ]);

    const seniors = donneesSeniors.dernier;
    const u18 = donneesU18.dernier;
    const prochainsMatchs = [donneesSeniors.prochain, donneesU18.prochain];

    const buildCard = (m) => `
      <article class="match-card">
          <div class="match-header">
              <span class="match-league">${m.league}</span>
              <div>
                <span class="badge ${m.domicile ? 'badge-dom' : 'badge-ext'}">${m.domicile ? 'Domicile' : 'Extérieur'}</span>
                <span class="badge ${m.estTermine ? 'badge-gray' : 'badge-blue'}">${m.estTermine ? 'Terminé' : 'À venir'}</span>
              </div>
          </div>
          <div class="match-body">
              <div class="team"><span class="team-name">${m.equipeLocale}</span></div>
              <div class="match-score">${m.estTermine ? `${m.score1}&nbsp;&ndash;&nbsp;${m.score2}` : 'VS'}</div>
              <div class="team"><span class="team-name">${m.equipeVisiteur}</span></div>
          </div>
          <div class="match-footer">
              <span>📅 ${m.date}</span>
              ${m.heure ? `<span>🕒 ${m.heure}</span>` : ''}
          </div>
      </article>`;

    const buildHistory = (matches) => `
      <section class="match-history" aria-label="Résultats précédents">
          <h3>Résultats précédents</h3>
          <ol class="history-list">
              ${matches.map((m) => `
                <li class="history-item">
                    <div class="history-meta">Journée ${m.journee} · ${m.date}${m.heure ? ` · ${m.heure}` : ''}</div>
                    <div class="history-result">
                        <span class="history-team">${m.equipeLocale}</span>
                        <strong class="history-score">${m.score1}&nbsp;&ndash;&nbsp;${m.score2}</strong>
                        <span class="history-team">${m.equipeVisiteur}</span>
                    </div>
                </li>`).join('')}
          </ol>
      </section>`;

    const htmlPage = `<!DOCTYPE html>
<html lang="fr" class="scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>COC Handball Cerizay | Site Officiel</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Montserrat:wght@700;800;900&display=swap" rel="stylesheet">
    <style>
        :root {
            --brand-blue: #002db3;
            --brand-blue-hover: #002288;
            --surface-color: #ffffff;
            --bg-color: #f8fafc; 
            --text-primary: #0f172a;
            --text-secondary: #475569;
            --text-muted: #94a3b8;
            --border-color: #e2e8f0;
            --radius-md: 16px;
            --radius-lg: 24px;
            --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
            --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
            --font-sans: 'Inter', sans-serif;
            --font-display: 'Montserrat', sans-serif;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: var(--font-sans); background-color: var(--bg-color); color: var(--text-primary); line-height: 1.6; }
        .container { width: 100%; max-width: 1100px; margin: 0 auto; padding: 0 24px; }
        
        /* NAVBAR */
        .navbar { position: fixed; top: 0; left: 0; right: 0; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border-color); z-index: 50; }
        .nav-content { display: flex; justify-content: space-between; align-items: center; height: 80px; }
        .brand { font-family: var(--font-display); font-weight: 900; font-size: 1.5rem; color: var(--brand-blue); text-decoration: none; }
        .nav-links { display: flex; gap: 32px; }
        .nav-link { color: var(--text-secondary); text-decoration: none; font-weight: 500; font-size: 0.95rem; transition: color 0.2s; }
        .nav-link:hover { color: var(--brand-blue); }

        /* HERO HEADER */
        .hero { padding: 150px 0 80px; background: linear-gradient(to bottom, #ffffff, var(--bg-color)); border-bottom: 1px solid var(--border-color); text-align: center; }
        .hero h1 { font-family: var(--font-display); font-size: 3rem; font-weight: 900; margin-bottom: 16px; line-height: 1.2; }
        .hero h1 span { color: var(--brand-blue); }
        .hero p { font-size: 1.125rem; color: var(--text-secondary); max-width: 600px; margin: 0 auto; }

        /* SECTIONS */
        .section { padding: 70px 0; }
        .section-header { text-align: center; margin-bottom: 40px; }
        .section-title { font-family: var(--font-display); font-size: 2rem; font-weight: 800; color: var(--text-primary); }
        .section-subtitle { font-size: 1rem; color: var(--text-secondary); margin-top: 8px; }

        /* MATCH CARDS */
        .match-card { background: var(--surface-color); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 28px; box-shadow: var(--shadow-sm); transition: transform 0.2s, box-shadow 0.2s; max-width: 650px; margin: 0 auto; }
        .match-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
        .match-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color); }
        .match-league { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted); }
        .badge { padding: 4px 12px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; margin-left: 6px; }
        .badge-blue { background: #eff6ff; color: #1d4ed8; }
        .badge-gray { background: #f1f5f9; color: #475569; }
        .badge-dom { background: #e0f2fe; color: #0369a1; }
        .badge-ext { background: #fef3c7; color: #b45309; }
        
        .match-body { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; gap: 16px; }
        .team { flex: 1; min-width: 0; text-align: center; }
        .team-name { display: block; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-display); font-weight: 700; font-size: 1.05rem; color: var(--text-primary); white-space: nowrap; }
        .match-score { min-width: 110px; text-align: center; font-family: var(--font-display); font-weight: 800; font-size: 1.5rem; color: var(--brand-blue); white-space: nowrap; }
        .match-footer { display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-secondary); border-top: 1px solid var(--border-color); padding-top: 14px; }

        /* PROCHAINS MATCHS */
        .upcoming-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px; }
        .upcoming-grid .match-card { max-width: none; margin: 0; }

        /* HISTORIQUE DES RÉSULTATS */
        .match-history { max-width: 650px; margin: 24px auto 0; }
        .match-history h3 { font-family: var(--font-display); font-size: 1rem; margin: 0 0 12px; }
        .history-list { list-style: none; display: grid; gap: 10px; }
        .history-item { background: var(--surface-color); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px 16px; }
        .history-meta { color: var(--text-muted); font-size: 0.75rem; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; }
        .history-result { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 12px; }
        .history-team { color: var(--text-primary); font-family: var(--font-display); font-size: 0.85rem; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .history-team:last-child { text-align: right; }
        .history-score { color: var(--brand-blue); font-family: var(--font-display); font-size: 1rem; white-space: nowrap; }

        /* TEAMS GRID */
        .teams-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
        .team-card { background: var(--surface-color); padding: 32px; border-radius: var(--radius-md); border: 1px solid var(--border-color); text-align: center; }
        .team-card-icon { width: 52px; height: 52px; background: #eff6ff; color: var(--brand-blue); border-radius: 14px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-weight: 800; font-family: var(--font-display); }
        .team-card h3 { font-family: var(--font-display); font-weight: 700; margin-bottom: 8px; }
        .team-card p { font-size: 0.9rem; color: var(--text-secondary); }

        /* FOOTER */
        .footer { background-color: #020617; color: #cbd5e1; padding: 50px 0 24px; margin-top: 60px; }
        .footer-bottom { border-top: 1px solid #1e293b; padding-top: 24px; display: flex; justify-content: space-between; font-size: 0.85rem; color: #64748b; }

        /* TABLETTE ET MOBILE */
        @media (max-width: 700px) {
            .container { padding: 0 16px; }

            .navbar { position: absolute; }
            .nav-content { height: auto; min-height: 96px; flex-direction: column; justify-content: center; gap: 8px; padding: 10px 0; }
            .brand { font-size: 1.2rem; line-height: 1; }
            .nav-links { width: 100%; justify-content: space-between; gap: 8px; }
            .nav-link { font-size: 0.72rem; white-space: nowrap; }

            .hero { padding: 145px 0 52px; }
            .hero h1 { font-size: clamp(1.85rem, 9vw, 2.35rem); margin-bottom: 12px; }
            .hero p { font-size: 1rem; }

            .section { padding: 50px 0; }
            .section-header { margin-bottom: 28px; }
            .section-title { font-size: 1.6rem; line-height: 1.25; }

            .match-card { padding: 20px 16px; }
            .match-header { align-items: flex-start; gap: 10px; margin-bottom: 18px; }
            .match-header > div { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
            .badge { margin-left: 0; padding: 3px 8px; }
            .match-body { gap: 8px; margin-bottom: 18px; }
            .team-name { font-size: 0.8rem; }
            .match-score { min-width: 72px; font-size: 1.15rem; }
            .match-footer { flex-wrap: wrap; justify-content: center; gap: 4px 14px; text-align: center; }
            .upcoming-grid { grid-template-columns: 1fr; gap: 16px; }

            .match-history { margin-top: 18px; }
            .history-item { padding: 12px; }
            .history-result { gap: 8px; }
            .history-team { font-size: 0.72rem; }
            .history-score { font-size: 0.9rem; }

            .teams-grid { grid-template-columns: 1fr; gap: 16px; }
            .team-card { padding: 24px; }
            #club .club-location { padding: 26px 18px !important; }

            .footer { margin-top: 30px; padding: 36px 0 20px; }
            .footer-bottom { flex-direction: column; align-items: center; gap: 6px; text-align: center; }
        }

        @media (max-width: 360px) {
            .nav-link { font-size: 0.66rem; }
            .nav-links { gap: 4px; }
            .match-league { font-size: 0.65rem; }
            .badge { font-size: 0.67rem; }
            .history-team { font-size: 0.66rem; }
        }
    </style>
</head>
<body>

    <nav class="navbar">
        <div class="container nav-content">
            <a href="#" class="brand">COC Handball</a>
            <div class="nav-links">
                <a href="#seniors" class="nav-link">Seniors</a>
                <a href="#u18" class="nav-link">U18</a>
                <a href="#equipes" class="nav-link">Nos Équipes</a>
                <a href="#club" class="nav-link">Infos Pratiques</a>
            </div>
        </div>
    </nav>

    <header class="hero">
        <div class="container">
            <h1>COC HANDBALL CERIZAY<br><span>Espace Officiel</span></h1>
            <p>Retrouvez les résultats en direct et les informations du club.</p>
        </div>
    </header>

    <main>
        <!-- SENIORS -->
        <section id="seniors" class="section">
            <div class="container">
                <div class="section-header">
                    <h2 class="section-title">Équipe Première (Seniors)</h2>
                    <p class="section-subtitle">Dernier résultat enregistré</p>
                </div>
                ${buildCard(seniors)}
                ${buildHistory(historiquesSeniors)}
            </div>
        </section>

        <!-- U18 -->
        <section id="u18" class="section" style="background: var(--surface-color);">
            <div class="container">
                <div class="section-header">
                    <h2 class="section-title">Équipe Jeunes (U18)</h2>
                    <p class="section-subtitle">Dernier résultat enregistré</p>
                </div>
                ${buildCard(u18)}
                ${buildHistory(historiquesU18)}
            </div>
        </section>

        <!-- PROCHAINS MATCHS -->
        <section id="avenir" class="section">
            <div class="container">
                <div class="section-header">
                    <h2 class="section-title">Prochains Matchs</h2>
                    <p class="section-subtitle">Les prochains rendez-vous du COC Handball</p>
                </div>
                <div class="upcoming-grid">
                    ${prochainsMatchs.map(buildCard).join('')}
                </div>
            </div>
        </section>

        <!-- NOS ÉQUIPES -->
        <section id="equipes" class="section">
            <div class="container">
                <div class="section-header">
                    <h2 class="section-title">Nos Catégories</h2>
                    <p class="section-subtitle">Les équipes engagées cette saison</p>
                </div>
                <div class="teams-grid">
                    <div class="team-card">
                        <div class="team-card-icon">U9</div>
                        <h3>Moins de 9 ans</h3>
                        <p>Entraînements le mercredi</p>
                    </div>
                    <div class="team-card">
                        <div class="team-card-icon">U18</div>
                        <h3>Moins de 18 ans</h3>
                        <p>Entraînements le mardi & vendredi</p>
                    </div>
                    <div class="team-card">
                        <div class="team-card-icon">SEN</div>
                        <h3>Seniors</h3>
                        <p>Entraînements le vendredi</p>
                    </div>
                </div>
            </div>
        </section>

        <!-- INFOS PRATIQUES -->
        <section id="club" class="section" style="background: var(--surface-color);">
            <div class="container">
                <div class="section-header">
                    <h2 class="section-title">Salle de Match & Entraînement</h2>
                </div>
                <div class="club-location" style="background: var(--bg-color); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 36px; text-align: center; max-width: 550px; margin: 0 auto;">
                    <h3 style="font-family: var(--font-display); font-size: 1.25rem; margin-bottom: 8px;">Salle Léo Lagrange</h3>
                    <p style="color: var(--text-secondary);">Rue Alain Mimoun, 79140 Cerizay</p>
                </div>
            </div>
        </section>
    </main>

    <footer class="footer">
        <div class="container">
            <div class="footer-bottom">
                <p>&copy; 2026 COC Handball Cerizay. Tous droits réservés.</p>
                <p>Site Officiel</p>
            </div>
        </div>
    </footer>

</body>
</html>`;

    return new Response(htmlPage, { headers: { "content-type": "text/html;charset=UTF-8" } });
  }
};
