/*
 * DailyGameTree — shared "Random game" button logic.
 *
 * Include this on any page with:
 *   <script src="/random-game.js" defer></script>
 *
 * and add a button/link anywhere on the page with the attribute
 * `data-random-game-btn` (see .random-btn markup in index.html / each
 * game's index.html). Clicking it sends the visitor to a random game
 * from games.json, preferring one they haven't visited yet this
 * session.
 *
 * On a game page, add `data-game="<folder>"` to <body> (matching the
 * game's "folder" value in games.json) so this script can mark that
 * game as visited and exclude it from the random pick.
 *
 * This is intentionally the ONLY place that needs to know how to pick
 * a random game: because the game list always comes from games.json
 * at request time, adding a new game to games.json is enough to make
 * it show up in the random rotation everywhere — no existing page
 * needs to be edited.
 */
(function () {
  'use strict';

  var VISITED_KEY = 'dgt_visited_games';

  function getVisited() {
    try {
      var raw = sessionStorage.getItem(VISITED_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function addVisited(folder) {
    if (!folder) return;
    try {
      var visited = getVisited();
      if (visited.indexOf(folder) === -1) {
        visited.push(folder);
        sessionStorage.setItem(VISITED_KEY, JSON.stringify(visited));
      }
    } catch (e) {
      /* sessionStorage unavailable (private mode etc.) — degrade silently */
    }
  }

  function currentGameFolder() {
    return document.body ? document.body.getAttribute('data-game') : null;
  }

  // Mark this page's own game as "visited" as soon as the script runs,
  // so the very first random pick from here already excludes it.
  addVisited(currentGameFolder());

  function pickRandomGame(games, excludeFolder) {
    if (!games || !games.length) return null;
    var pool = games.filter(function (g) {
      return g.folder !== excludeFolder;
    });
    if (!pool.length) return null;

    var visited = getVisited();
    var unvisited = pool.filter(function (g) {
      return visited.indexOf(g.folder) === -1;
    });
    // Prefer a game not yet played this session; once everything has
    // been visited, fall back to the full pool (still excluding the
    // current game) rather than getting stuck.
    var candidates = unvisited.length ? unvisited : pool;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function goToRandomGame(btn) {
    if (btn) btn.classList.add('is-loading');
    fetch('/games.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (games) {
        var pick = pickRandomGame(games, currentGameFolder());
        if (pick) {
          window.location.href = '/' + pick.folder + '/';
        } else if (btn) {
          btn.classList.remove('is-loading');
        }
      })
      .catch(function (err) {
        console.error('Random game: could not load games.json', err);
        if (btn) btn.classList.remove('is-loading');
      });
  }

  function init() {
    var btns = document.querySelectorAll('[data-random-game-btn]');
    if (!btns.length) return;
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          goToRandomGame(btn);
        });
      })(btns[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
