/**
 * Bench Map UK - Complete Application
 * Benches: GitHub GeoJSON tiles
 * Firebase: Ratings, favorites, new benches
 * Drawer menu with stats & shortcuts
 */

(function () {
  'use strict';

  console.log('Initializing Bench Map UK...');

  // ====== CONFIGURATION ======
  const CONFIG = {
    LOADER_FADE_DELAY: 2000,
    RATING_CATEGORIES: ['comfort', 'ambience', 'view'],
    MAP_BOUNDS: [[48.5, -11], [61.5, 4]],
    MAP_CENTER: [54.5, -3],
    MAP_ZOOM: 5.5,  // Adjusted for better UK-wide view on initial load
    TILE_ROWS: 10,
    TILE_COLS: 10,
    // Only tiles that exist on disk — prevents 404s for sea/out-of-bounds grid cells
    EXISTING_TILES: new Set([
      '0_2','0_3',
      '1_3','1_4','1_5','1_6','1_7','1_8','1_9',
      '2_3','2_4','2_5','2_6','2_7','2_8','2_9',
      '3_3','3_4','3_5','3_6','3_7','3_8','3_9',
      '4_0','4_1','4_2','4_3','4_4','4_5','4_6','4_7','4_8',
      '5_1','5_2','5_3','5_4','5_5','5_6',
      '6_1','6_2','6_3','6_4','6_5','6_6',
      '7_1','7_2','7_3','7_4','7_5','7_6',
      '8_4','8_5','8_6',
      '9_6','9_7'
    ]),
    CLUSTER_RADIUS: 80,
    CLUSTER_DISABLE_AT_ZOOM: 16,
    NEAREST_DISTANCE_THRESHOLD: 20,
    MIN_RATING_THRESHOLD: 4.0,
    MIN_RATING_COUNT: 3,
    GITHUB_TILE_BASE: '/data/tile_',
    BENCH_TAGS: [
      { id: 'chatty',     emoji: '💬', label: 'Chatty bench',   desc: 'Talk to strangers!',          color: '#FF9800' },
      { id: 'chess',      emoji: '♟️', label: 'Chess / games',  desc: 'Board games welcome',         color: '#9C27B0' },
      { id: 'books',      emoji: '📚', label: 'Book exchange',  desc: 'Swap & share books',          color: '#1E88E5' },
      { id: 'dogs',       emoji: '🐕', label: 'Dog friendly',   desc: 'Great for dog walkers',       color: '#8D6E63' },
      { id: 'scenic',     emoji: '🌅', label: 'Scenic view',    desc: 'Worth the trip for views',    color: '#FF7043' },
      { id: 'sheltered',  emoji: '⛱️', label: 'Sheltered',      desc: 'Covered or out of the wind',  color: '#78909C' },
      { id: 'accessible', emoji: '♿', label: 'Accessible',      desc: 'Wheelchair accessible',       color: '#26C6DA' },
      { id: 'memorial',   emoji: '🕊️', label: 'Memorial',       desc: 'Dedicated to someone',        color: '#BDBDBD' },
      { id: 'wildlife',   emoji: '🐦', label: 'Wildlife spot',  desc: 'Birds, squirrels & more',     color: '#5E8A5E' },
      { id: 'community',  emoji: '🤝', label: 'Community hub',  desc: 'Regular local meetup spot',   color: '#EC407A' }
    ],
    FIREBASE_CONFIG: {
      apiKey: "AIzaSyAg-VG3laAp8kvel5mC9Q_kWhLv6xvFTPY",
      authDomain: "bench-rating.firebaseapp.com",
      projectId: "bench-rating",
      storageBucket: "bench-rating.firebasestorage.app",
      messagingSenderId: "601862513386",
      appId: "1:601862513386:web:485fa761244ea436a4ad93"
    }
  };

  // ====== STATE ======
  const state = {
    db: null,
    storage: null,
    map: null,
    markerCluster: null,
    allBenches: [],
    markerRefs: {},
    tilesLoaded: new Set(),
    isFetching: false,
    loaderHidden: false,
    addingBench: false,
    newBenchMarker: null,
    pendingBenchLocation: null,
    nearestBenchMarker: null,
    userLocationMarker: null,
    userAccuracyCircle: null,
    routeLayer: null,
    userLocation: null,
    favorites: new Set(),
    visitedBenches: new Set(),
    drawerOpen: false,
    isMenuOpen: false,
    currentBenchId: null,
    currentBenchDistance: null,
    filterActive: false,
    activeTagFilter: null,
    urlBenchCoords: null,
    inscriptionIndex: null
  };

  // ====== UTILITIES ======
  function formatDistance(meters) {
    if (meters < 1000) return Math.round(meters) + 'm';
    return (meters / 1000).toFixed(1) + 'km';
  }

  function showNotification(message, type = 'info', duration = 3000) {
    const el = document.createElement('div');
    el.className = `notification notification-${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  function sanitizeBenchId(id) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  // Escape user-supplied strings before injecting into innerHTML.
  // Used for inscription, conversation_topic, notes, colour, etc.
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ====== LOCAL STORAGE ======
  function getStorage(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function setStorage(key, value) { try { localStorage.setItem(key, value); } catch {} }

  function loadUserData() {
    const favs = getStorage('favorites');
    const visited = getStorage('visited');
    if (favs) try { state.favorites = new Set(JSON.parse(favs)); } catch {}
    if (visited) try { state.visitedBenches = new Set(JSON.parse(visited)); } catch {}
  }

  function saveUserData() {
    setStorage('favorites', JSON.stringify(Array.from(state.favorites)));
    setStorage('visited', JSON.stringify(Array.from(state.visitedBenches)));
  }

  // ====== FIREBASE (Ratings & New Benches Only) ======
  function initFirebase() {
    try {
      if (window.firebase && CONFIG.FIREBASE_CONFIG) {
        firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
        state.db = firebase.firestore();
        if (firebase.storage) {
          try { state.storage = firebase.storage(); } catch (e) { console.warn('Storage init failed:', e); }
        }
        console.log('Firebase initialized (Firestore + Storage)');
        loadUserData();
      }
    } catch (error) {
      console.error('Firebase error:', error);
      state.db = null;
      state.storage = null;
    }
  }

  // ====== PHOTO UPLOADS ======
  // Photos are uploaded to Firebase Storage at bench-photos/{benchId}/{photoId}.jpg
  // Metadata is stored in Firestore collection `benchPhotos` with status 'pending'.
  // Public app only displays photos with status 'approved' (set by admin).
  const PHOTO_CONFIG = {
    MAX_DIMENSION: 1600,           // longest edge after resize, in CSS pixels
    JPEG_QUALITY: 0.85,
    MAX_FILE_SIZE_BYTES: 8 * 1024 * 1024,  // pre-resize cap to reject huge files outright
    MAX_PER_BENCH_PER_SESSION: 3   // soft client-side limit to discourage flooding
  };

  // Resize+recompress an image File to a JPEG Blob using a canvas.
  // Preserves aspect ratio; longest edge is clamped to MAX_DIMENSION.
  function resizeImageFile(file) {
    return new Promise(function(resolve, reject) {
      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        return reject(new Error('Not an image file'));
      }
      if (file.size > PHOTO_CONFIG.MAX_FILE_SIZE_BYTES) {
        return reject(new Error('Photo too large (max 8 MB)'));
      }
      const reader = new FileReader();
      reader.onerror = function() { reject(new Error('Could not read file')); };
      reader.onload = function(e) {
        const img = new Image();
        img.onerror = function() { reject(new Error('Could not decode image')); };
        img.onload = function() {
          const maxDim = PHOTO_CONFIG.MAX_DIMENSION;
          let w = img.naturalWidth, h = img.naturalHeight;
          if (Math.max(w, h) > maxDim) {
            const scale = maxDim / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          // Solid white background — guards against transparent PNGs becoming black JPEGs.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function(blob) {
            if (!blob) return reject(new Error('Could not encode image'));
            resolve({ blob: blob, width: w, height: h });
          }, 'image/jpeg', PHOTO_CONFIG.JPEG_QUALITY);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Trigger the file picker for the given bench.
  function startPhotoUpload(benchId) {
    if (!state.storage || !state.db) {
      showNotification('Photo uploads unavailable right now', 'error');
      return;
    }
    const sessionKey = 'photoUploads_' + benchId;
    const sessionCount = parseInt(getStorage(sessionKey) || '0', 10);
    if (sessionCount >= PHOTO_CONFIG.MAX_PER_BENCH_PER_SESSION) {
      showNotification('You\'ve added several photos to this bench already — thanks!', 'info');
      return;
    }
    const input = document.getElementById('benchPhotoInput');
    if (!input) return;
    // Clear any previous selection so re-picking the same file fires `change`.
    input.value = '';
    input.onchange = function() {
      const file = input.files && input.files[0];
      if (!file) return;
      uploadBenchPhoto(benchId, file);
    };
    input.click();
  }

  // Resize, upload, and write Firestore metadata (status: 'pending').
  function uploadBenchPhoto(benchId, file) {
    const statusEl = document.getElementById('photo-upload-status-' + benchId);
    const setStatus = function(msg, kind) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.className = 'photo-upload-status' + (kind ? ' ' + kind : '');
    };

    setStatus('Resizing photo…', 'info');

    resizeImageFile(file).then(function(result) {
      setStatus('Uploading…', 'info');
      const sanitizedId = sanitizeBenchId(benchId);
      const photoId = Date.now() + '_' + Math.random().toString(36).slice(2, 10);
      const path = 'bench-photos/' + sanitizedId + '/' + photoId + '.jpg';
      const ref = state.storage.ref().child(path);
      const metadata = { contentType: 'image/jpeg', cacheControl: 'public,max-age=31536000' };
      const task = ref.put(result.blob, metadata);

      task.on('state_changed',
        function(snap) {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          setStatus('Uploading… ' + pct + '%', 'info');
        },
        function(err) {
          console.error('Photo upload error:', err);
          setStatus('Upload failed: ' + (err.message || err.code || 'unknown error'), 'error');
        },
        function() {
          ref.getDownloadURL().then(function(url) {
            return state.db.collection('benchPhotos').doc(photoId).set({
              benchId: sanitizedId,
              storagePath: path,
              url: url,
              status: 'pending',
              width: result.width,
              height: result.height,
              sizeBytes: result.blob.size,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }).then(function() {
            // Track session count
            const sessionKey = 'photoUploads_' + benchId;
            const n = parseInt(getStorage(sessionKey) || '0', 10) + 1;
            setStorage(sessionKey, String(n));
            setStatus('✓ Thanks! Your photo is awaiting moderation.', 'success');
            setTimeout(function() { setStatus('', ''); }, 5000);
          }).catch(function(err) {
            console.error('Photo metadata write failed:', err);
            setStatus('Upload saved but indexing failed: ' + (err.message || err.code), 'error');
          });
        }
      );
    }).catch(function(err) {
      console.error('Resize error:', err);
      setStatus(err.message || 'Could not process photo', 'error');
    });
  }

  // Fetch approved photos for a bench from Firebase and (if available) OpenBenches.
  // OB photos come from tile properties (stored by merge_openbenches.py) to avoid CORS.
  function fetchBenchPhotos(benchId) {
    const bench = state.allBenches.find(function(b) { return b.id === benchId; });
    const obPaths = (bench && bench.props && bench.props.openbenches_photos) || [];
    const obPhotos = obPaths
      .filter(function(path) { return typeof path === 'string' && path.startsWith('/image/'); })
      .map(function(path) { return { url: 'https://openbenches.org' + path, source: 'ob' }; });

    const firebasePromise = state.db
      ? state.db.collection('benchPhotos')
          .where('benchId', '==', sanitizeBenchId(benchId))
          .where('status', '==', 'approved')
          .get()
          .then(function(snap) {
            const docs = [];
            snap.forEach(function(doc) { docs.push(doc.data()); });
            docs.sort(function(a, b) {
              const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
              const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
              return tb - ta;
            });
            return docs.map(function(p) { return { url: p.url, source: 'firebase' }; });
          })
          .catch(function() { return []; })
      : Promise.resolve([]);

    firebasePromise.then(function(firebasePhotos) {
      var gallery = document.getElementById('photo-gallery-' + benchId);
      if (!gallery) return;

      var allPhotos = firebasePhotos.concat(obPhotos);
      if (allPhotos.length === 0) {
        gallery.innerHTML = '';
        return;
      }

      renderPhotoCarousel(gallery, benchId, allPhotos, obPhotos.length > 0);

      if (firebasePhotos.length > 0) {
        var label = document.getElementById('photo-upload-label-' + benchId);
        if (label) label.textContent = 'Add another';
      }
    });
  }

  function renderPhotoCarousel(gallery, benchId, photos, hasObPhotos) {
    var urls = photos.map(function(p) { return p.url; });
    var idx = 0;

    function buildHtml(i) {
      var safeUrl = escapeHtml(urls[i] || '');
      var safeUrlAttr = safeUrl.replace(/'/g, '&#39;');
      var multi = urls.length > 1;
      return '<div class="photo-carousel" id="photo-carousel-' + benchId + '">'
        + '<img class="photo-carousel-img" src="' + safeUrl + '" alt="Bench photo" loading="lazy" '
        +   'onclick="window.benchApp.openPhotoLightbox(\'' + safeUrlAttr + '\')" />'
        + (multi ? '<button class="photo-carousel-btn prev" aria-label="Previous photo" '
        +   'onclick="window.benchApp.carouselNav(\'' + benchId + '\',-1)">&#8249;</button>' : '')
        + (multi ? '<button class="photo-carousel-btn next" aria-label="Next photo" '
        +   'onclick="window.benchApp.carouselNav(\'' + benchId + '\',1)">&#8250;</button>' : '')
        + (multi ? '<div class="photo-carousel-counter">' + (i + 1) + ' / ' + urls.length + '</div>' : '')
        + '</div>'
        + (hasObPhotos ? '<div class="ob-photo-credit">Photos from '
        +   '<a href="https://openbenches.org" target="_blank" rel="noopener">OpenBenches</a>'
        +   ' — CC BY-SA 4.0</div>' : '');
    }

    gallery.innerHTML = buildHtml(idx);

    // Store URLs on the gallery element so carouselNav can update in place
    gallery._carouselUrls = urls;
    gallery._carouselIdx  = idx;
    gallery._carouselObCredit = hasObPhotos;
  }

  function carouselNav(benchId, dir) {
    var gallery = document.getElementById('photo-gallery-' + benchId);
    if (!gallery || !gallery._carouselUrls) return;
    var urls = gallery._carouselUrls;
    var idx = ((gallery._carouselIdx + dir) + urls.length) % urls.length;
    gallery._carouselIdx = idx;

    var carousel = document.getElementById('photo-carousel-' + benchId);
    if (!carousel) return;

    var img = carousel.querySelector('.photo-carousel-img');
    var counter = carousel.querySelector('.photo-carousel-counter');
    var safeUrl = escapeHtml(urls[idx]);
    if (img) {
      img.style.opacity = '0';
      setTimeout(function() {
        img.src = safeUrl;
        img.setAttribute('onclick', 'window.benchApp.openPhotoLightbox(\'' + safeUrl.replace(/'/g, '&#39;') + '\')');
        img.style.opacity = '1';
      }, 120);
    }
    if (counter) counter.textContent = (idx + 1) + ' / ' + urls.length;
  }

  function openPhotoLightbox(url) {
    const box = document.getElementById('photoLightbox');
    const img = document.getElementById('photoLightboxImg');
    if (!box || !img) return;
    img.src = url;
    box.classList.add('open');
    box.setAttribute('aria-hidden', 'false');
  }

  function closePhotoLightbox() {
    const box = document.getElementById('photoLightbox');
    const img = document.getElementById('photoLightboxImg');
    if (!box) return;
    box.classList.remove('open');
    box.setAttribute('aria-hidden', 'true');
    if (img) img.src = '';
  }

  function initPhotoLightbox() {
    const box = document.getElementById('photoLightbox');
    const closeBtn = document.getElementById('photoLightboxClose');
    if (!box || !closeBtn) return;
    closeBtn.addEventListener('click', closePhotoLightbox);
    box.addEventListener('click', function(e) {
      // Close on backdrop click, but not when clicking the image itself
      if (e.target === box) closePhotoLightbox();
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && box.classList.contains('open')) closePhotoLightbox();
    });
  }

  // ====== ICONS ======
  // Cleaned bench SVG path from noun-bench-6258340 (attribution removed)
  // viewBox: 0 0 32 40 — bench with seat, back, and legs
  var BENCH_PATH = 'M27.5,7l-23,0l0,-1c-0,-0.276 -0.224,-0.5 -0.5,-0.5c-0.276,0 -0.5,0.224 -0.5,0.5l0,10.5l-1.5,-0c-0.276,0 -0.5,0.224 -0.5,0.5l0,3.5c0,0.276 0.224,0.5 0.5,0.5l1,-0l0,5c-0,0.276 0.224,0.5 0.5,0.5c0.276,0 0.5,-0.224 0.5,-0.5l0,-5l24,-0l0,5c-0,0.276 0.224,0.5 0.5,0.5c0.276,0 0.5,-0.224 0.5,-0.5l0,-5l1,-0c0.276,-0 0.5,-0.224 0.5,-0.5l0,-3.5c0,-0.276 -0.224,-0.5 -0.5,-0.5l-1.5,-0l0,-10.5c-0,-0.276 -0.224,-0.5 -0.5,-0.5c-0.276,0 -0.5,0.224 -0.5,0.5l0,1Zm-23,6.5l0,3l23,-0l0,-3l-23,-0Z';

  // Helper — circular marker with inline bench SVG at 60% of circle diameter
  function makeBenchIcon(bgColor, opts) {
    var size  = (opts && opts.size)  || 32;
    var pulse = (opts && opts.pulse) || false;
    // SVG sized to 68% of the circle; viewBox matches noun-bench-6258340 (32×40)
    var svgSize = Math.round(size * 0.68);
    var svgHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40"'
      + ' width="' + svgSize + '" height="' + svgSize + '">'
      + '<path d="' + BENCH_PATH + '" fill="#FDFBF7" fill-rule="evenodd"/>'
      + '</svg>';
    var circleHtml = '<div class="bench-marker" style="'
      + 'width:' + size + 'px;height:' + size + 'px;'
      + 'background:' + bgColor + ';'
      + (pulse ? 'animation:benchPulse 2s ease-in-out infinite;' : '')
      + '">' + svgHtml + '</div>';
    return L.divIcon({
      className: 'bench-marker-wrapper',
      html:       circleHtml,
      iconSize:   [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  const icons = {
    bench:        makeBenchIcon('#3A5F3A'),                           // earthy green
    favorite:     makeBenchIcon('#D4810A', { size: 36 }),             // warm amber
    highlight:    makeBenchIcon('#3A5F3A', { size: 36, pulse: true }), // earthy green pulse
    newBench:     makeBenchIcon('#1B7A5E', { size: 36, pulse: true }), // forest teal pulse
    userLocation: L.divIcon({
      className: 'user-location-marker',
      html: '<div class="user-location-dot"></div><div class="user-location-pulse"></div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    })
  };

  // ====== TAG ICONS ======
  // Each tag gets a circle marker in the tag's own colour
  const TAG_ICONS = {};
  CONFIG.BENCH_TAGS.forEach(function(tag) {
    TAG_ICONS[tag.id] = makeBenchIcon(tag.color, { size: 30 });
  });

  // Derive community tags from OSM/user properties
  function getTagsFromProps(props) {
    const tags = [];
    if (props.community_tags) {
      try {
        const ut = typeof props.community_tags === 'string'
          ? JSON.parse(props.community_tags)
          : props.community_tags;
        if (Array.isArray(ut)) ut.forEach(function(t) { if (!tags.includes(t)) tags.push(t); });
      } catch {}
    }
    // Derive from OSM tags
    if (props.chat_bench === 'yes' || props.initiative === 'chat_bench' || props.conversation_topic) {
      if (!tags.includes('chatty')) tags.push('chatty');
    }
    if ((props.topic && props.topic.trim()) || (props.inscription && props.inscription.trim())) {
      if (!tags.includes('memorial')) tags.push('memorial');
    }
    if (props.wheelchair === 'yes') {
      if (!tags.includes('accessible')) tags.push('accessible');
    }
    if (props.covered === 'yes' || props.shelter === 'yes') {
      if (!tags.includes('sheltered')) tags.push('sheltered');
    }
    return tags;
  }

  // Pick the best marker icon based on tags and favourite status
  // Priority: favourite > chatty > community > chess > books > scenic > wildlife > dogs > memorial > accessible > sheltered > default
  const TAG_ICON_PRIORITY = ['chatty', 'community', 'chess', 'books', 'scenic', 'wildlife', 'dogs', 'memorial', 'accessible', 'sheltered'];
  function getMarkerIconForTags(tags, isFavorite) {
    if (isFavorite) return icons.favorite;
    for (var i = 0; i < TAG_ICON_PRIORITY.length; i++) {
      if (tags.includes(TAG_ICON_PRIORITY[i])) return TAG_ICONS[TAG_ICON_PRIORITY[i]];
    }
    return icons.bench;
  }

  // ====== COMMUNITY TAG PICKER — drawer functions ======

  // Fetch any Firestore-stored tags for an existing bench and apply them to the picker
  function fetchBenchCommunityTags(benchId) {
    if (!state.db) return;
    state.db.collection('benchCommunityTags').doc(benchId).get().then(function(doc) {
      if (!doc.exists) return;
      var firestoreTags = doc.data().tags;
      if (!Array.isArray(firestoreTags) || !firestoreTags.length) return;

      // Update picker chips to reflect Firestore state
      var picker = document.getElementById('tag-picker-' + benchId);
      if (!picker) return;
      picker.querySelectorAll('.tag-toggle-chip').forEach(function(chip) {
        var active = firestoreTags.includes(chip.dataset.tag);
        chip.classList.toggle('active', active);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      });

      // Also update in-memory bench props so the marker icon stays consistent
      var bench = state.allBenches.find(function(b) { return b.id === benchId; });
      if (bench) {
        bench.props.community_tags = JSON.stringify(firestoreTags);
        var updatedTags = getTagsFromProps(bench.props);
        var isFav = state.favorites.has(benchId);
        bench.marker.setIcon(getMarkerIconForTags(updatedTags, isFav));
      }
    }).catch(function(err) {
      console.warn('Could not fetch community tags:', err);
    });
  }

  // Toggle a chip's active state (called from onclick)
  function toggleTagChip(el) {
    var active = el.classList.toggle('active');
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  // Save the currently selected chips to Firestore
  function saveBenchCommunityTags(benchId) {
    if (!state.db) {
      showNotification('Sign-in required to save tags', 'error');
      return;
    }

    var picker = document.getElementById('tag-picker-' + benchId);
    if (!picker) return;

    var selectedTags = Array.from(picker.querySelectorAll('.tag-toggle-chip.active'))
      .map(function(chip) { return chip.dataset.tag; });

    var statusEl = document.getElementById('tag-save-status-' + benchId);
    var saveBtn  = document.getElementById('save-tags-btn-' + benchId);
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    state.db.collection('benchCommunityTags').doc(benchId).set({
      tags: selectedTags,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).then(function() {
      if (saveBtn)   { saveBtn.disabled = false; saveBtn.textContent = 'Save tags'; }
      if (statusEl)  { statusEl.textContent = '✓ Tags saved — thanks!'; statusEl.className = 'tag-save-status success'; }
      setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 3000);

      // Update in-memory bench so marker icon refreshes immediately
      var bench = state.allBenches.find(function(b) { return b.id === benchId; });
      if (bench) {
        bench.props.community_tags = JSON.stringify(selectedTags);
        var updatedTags = getTagsFromProps(bench.props);
        var isFav = state.favorites.has(benchId);
        bench.marker.setIcon(getMarkerIconForTags(updatedTags, isFav));
      }
    }).catch(function(err) {
      console.error('Tag save error:', err);
      if (saveBtn)  { saveBtn.disabled = false; saveBtn.textContent = 'Save tags'; }
      if (statusEl) { statusEl.textContent = '✗ Could not save. Try again.'; statusEl.className = 'tag-save-status error'; }
    });
  }

  // ====== TAG FILTER BAR ======
  function filterByTag(tagId) {
    state.activeTagFilter = tagId || null;

    // Update chip active state in panel
    var panel = document.getElementById('tagFilterPanel');
    if (panel) {
      panel.querySelectorAll('.filter-chip').forEach(function(chip) {
        chip.classList.toggle('active', chip.dataset.tag === (tagId || 'all'));
      });
    }

    // Update filter fab active state
    var toggle = document.getElementById('menuBtn');
    if (toggle) {
      if (tagId) {
        toggle.classList.add('active');
      } else {
        toggle.classList.remove('active');
      }
    }

    if (!tagId) {
      // Show all benches
      state.allBenches.forEach(function(bench) {
        if (!state.markerCluster.hasLayer(bench.marker)) {
          state.markerCluster.addLayer(bench.marker);
        }
      });
    } else {
      var count = 0;
      state.allBenches.forEach(function(bench) {
        var tags = getTagsFromProps(bench.props);
        if (tags.includes(tagId)) {
          if (!state.markerCluster.hasLayer(bench.marker)) {
            state.markerCluster.addLayer(bench.marker);
          }
          count++;
        } else {
          state.markerCluster.removeLayer(bench.marker);
        }
      });
      var tagDef = CONFIG.BENCH_TAGS.find(function(t) { return t.id === tagId; });
      showNotification(
        count > 0
          ? 'Showing ' + count + ' ' + (tagDef ? tagDef.label : tagId) + ' benches'
          : 'No ' + (tagDef ? tagDef.label : tagId) + ' benches loaded yet — zoom in to find some!',
        count > 0 ? 'info' : 'warning',
        3000
      );
    }
  }

  function initFilterBar() {
    // The filter button is now #menuBtn (repurposed); panel drops from #tagFilterWrapper
    var toggle = document.getElementById('menuBtn');
    var panel  = document.getElementById('tagFilterPanel');
    if (!toggle || !panel) return;

    function openPanel() {
      panel.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.classList.add('active');
    }
    function closePanel() {
      panel.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.classList.remove('active');
    }

    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      panel.classList.contains('open') ? closePanel() : openPanel();
    });

    panel.querySelectorAll('.filter-chip').forEach(function(chip) {
      chip.addEventListener('click', function() {
        var tag = chip.dataset.tag;
        filterByTag(tag === 'all' || state.activeTagFilter === tag ? null : tag);
        closePanel();
      });
    });

    document.addEventListener('click', function(e) {
      var wrapper = document.getElementById('tagFilterWrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        closePanel();
      }
    });
  }

  // ====== SHARE ======
  function shareBench(benchId) {
    var bench = state.allBenches.find(function(b) { return b.id === benchId; });
    if (!bench) return;
    var lat = bench.latlng[0], lng = bench.latlng[1];
    var url = location.origin + location.pathname + '?lat=' + lat + '&lng=' + lng + '&zoom=17';
    var title = 'Bench Map UK';
    var inscription = (bench.props.topic || bench.props.inscription || '').replace(/\s+/g, ' ').trim();
    var text = inscription
      ? 'Found a memorial bench: "' + inscription.substring(0, 80) + (inscription.length > 80 ? '…' : '') + '"'
      : 'Check out this bench on Bench Map UK!';

    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url }).catch(function() {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(function() { showNotification('Link copied to clipboard!', 'success'); })
        .catch(function() { fallbackCopy(url); });
    } else {
      fallbackCopy(url);
    }
  }

  function fallbackCopy(text) {
    var el = document.createElement('input');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); showNotification('Link copied!', 'success'); } catch {}
    el.remove();
  }

  // ====== PEOPLE HERE TODAY ======
  function fetchCheckInsToday(benchId) {
    if (!state.db) return;
    var sanitizedId = sanitizeBenchId(benchId);
    var oneDayAgo = new Date(Date.now() - 86400000);
    state.db.collection('benchCheckIns')
      .where('benchId', '==', sanitizedId)
      .where('timestamp', '>', oneDayAgo)
      .get()
      .then(function(snapshot) {
        var el = document.getElementById('checkins-today-' + benchId);
        if (!el) return;
        var count = snapshot.size;
        if (count > 0) {
          el.innerHTML = '<div class="checkins-today">👥 ' + count + ' ' + (count === 1 ? 'person' : 'people') + ' here today</div>';
        }
      })
      .catch(function() {});
  }

  // ====== WELCOME OVERLAY ======
  function showWelcomeOverlay() {
    if (getStorage('welcomeDismissed') === 'true') return;
    var overlay = document.getElementById('welcomeOverlay');
    if (overlay) {
      setTimeout(function() {
        overlay.classList.add('show');
        // Restart map animations so they play after the overlay fades in,
        // not from page-load time.
        ['.welcome-route', '.welcome-bench-dest'].forEach(function(sel) {
          var el = overlay.querySelector(sel);
          if (!el) return;
          el.style.animation = 'none';
          void el.offsetHeight;
          el.style.animation = '';
        });
        var btn = overlay.querySelector('.welcome-btn');
        if (btn) btn.focus();
      }, 600);
    }
  }

  function dismissWelcome() {
    setStorage('welcomeDismissed', 'true');
    var overlay = document.getElementById('welcomeOverlay');
    if (overlay) {
      overlay.classList.remove('show');
      setTimeout(function() { overlay.style.display = 'none'; }, 350);
    }
  }

  // ====== FORM TAG TOGGLE ======
  function toggleFormTag(tagId) {
    var btn = document.querySelector('.tag-select-btn[data-tag="' + tagId + '"]');
    if (!btn) return;
    btn.classList.toggle('active');
    // Show conversation topic sub-field only when chatty is selected
    if (tagId === 'chatty') {
      var section = document.getElementById('conversationTopicSection');
      if (section) section.style.display = btn.classList.contains('active') ? 'block' : 'none';
    }
  }

  // ====== LOADER ======
  function hideLoader() {
    if (state.loaderHidden) return;
    state.loaderHidden = true;
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(() => { 
        overlay.style.display = 'none'; 
        overlay.setAttribute('aria-hidden', 'true'); 
      }, 500);
    }
  }

  // ====== USER LOCATION (NEW) ======
  function initUserLocation() {
    // Check if we've already asked and been denied
    const locationDenied = getStorage('locationDenied');
    
    if (locationDenied === 'true') {
      console.log('Location previously denied');
      showLocationDeniedNotice();
      return;
    }
    
    if (!navigator.geolocation) {
      console.log('Geolocation not supported');
      return;
    }
    
    // Request location immediately on page load
    navigator.geolocation.getCurrentPosition(
      function(position) {
        // Success - show user location
        state.userLocation = L.latLng(position.coords.latitude, position.coords.longitude);
        
        // Add persistent marker
        if (state.userLocationMarker) {
          state.map.removeLayer(state.userLocationMarker);
        }
        
        state.userLocationMarker = L.marker(state.userLocation, { 
          icon: icons.userLocation 
        })
          .addTo(state.map)
          .bindPopup("📍 Your location");
        
        // Add accuracy circle if available
        if (position.coords.accuracy && position.coords.accuracy < 1000) {
          if (state.userAccuracyCircle) {
            state.map.removeLayer(state.userAccuracyCircle);
          }
          state.userAccuracyCircle = L.circle(state.userLocation, {
            radius: position.coords.accuracy,
            color: '#C85A40',
            fillColor: '#C85A40',
            fillOpacity: 0.1,
            weight: 1,
            opacity: 0.3
          }).addTo(state.map);
        }
        
        console.log('User location available:', state.userLocation);

        // Jump instantly to the user's location on first load (~1 mile radius at zoom 15),
        // unless deep-linking to a specific bench.
        if (!state.urlBenchCoords) {
          state.map.setView(state.userLocation, 15);
          loadVisibleTiles();
        }

        // Update any open drawer with distance
        if (state.drawerOpen && state.currentBenchId) {
          updateDrawerDistance();
        }
      },
      function(error) {
        // User denied or error occurred
        console.log('Geolocation error:', error.code);
        
        if (error.code === error.PERMISSION_DENIED) {
          // Remember that user denied
          setStorage('locationDenied', 'true');
          showLocationDeniedNotice();
        }
        // For other errors (timeout, unavailable), don't show anything
        // User can still use the app without location
      },
      {
        enableHighAccuracy: false,
        timeout: 30000,
        maximumAge: 300000
      }
    );
  }

  function showLocationDeniedNotice() {
    // Don't show if already dismissed
    if (getStorage('locationNoticeDismissed') === 'true') {
      return;
    }
    
    const notice = document.createElement('div');
    notice.className = 'location-notice';
    notice.innerHTML = `
      <div class="location-notice-content">
        <span>📍 Enable location to see distances and get directions</span>
        <button onclick="window.benchApp.dismissLocationNotice()" aria-label="Dismiss">×</button>
      </div>
    `;
    document.body.appendChild(notice);
    
    // Invalidate map size after banner appears (fixes mobile rendering)
    setTimeout(() => {
      if (state.map) {
        state.map.invalidateSize();
      }
    }, 100);
    
    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (notice.parentElement) {
        notice.style.opacity = '0';
        setTimeout(() => {
          notice.remove();
          // Invalidate map size after banner is removed
          if (state.map) {
            state.map.invalidateSize();
          }
        }, 300);
      }
    }, 10000);
  }

  function dismissLocationNotice() {
    setStorage('locationNoticeDismissed', 'true');
    document.querySelectorAll('.location-notice').forEach(el => {
      el.style.opacity = '0';
      setTimeout(() => {
        el.remove();
        // Invalidate map size after banner is removed
        if (state.map) {
          state.map.invalidateSize();
        }
      }, 300);
    });
  }

  function requestLocation() {
    // Clear the denied flag
    setStorage('locationDenied', 'false');
    setStorage('locationNoticeDismissed', 'false');
    
    // Remove any location denied notices
    document.querySelectorAll('.location-notice').forEach(el => el.remove());
    
    if (!navigator.geolocation) {
      showNotification('Geolocation not supported', 'error');
      return;
    }
    
    showNotification('Getting your location...', 'info');
    
    // Try again
    navigator.geolocation.getCurrentPosition(
      function(position) {
        state.userLocation = L.latLng(position.coords.latitude, position.coords.longitude);
        
        if (state.userLocationMarker) {
          state.map.removeLayer(state.userLocationMarker);
        }
        if (state.userAccuracyCircle) {
          state.map.removeLayer(state.userAccuracyCircle);
        }
        
        state.userLocationMarker = L.marker(state.userLocation, { 
          icon: icons.userLocation 
        })
          .addTo(state.map)
          .bindPopup("📍 Your location");
        
        // Add accuracy circle
        if (position.coords.accuracy && position.coords.accuracy < 1000) {
          state.userAccuracyCircle = L.circle(state.userLocation, {
            radius: position.coords.accuracy,
            color: '#C85A40',
            fillColor: '#C85A40',
            fillOpacity: 0.1,
            weight: 1,
            opacity: 0.3
          }).addTo(state.map);
        }
        
        state.map.setView(state.userLocation, 15);
        showNotification('Location enabled!', 'success');
        
        // Update drawer if open
        if (state.drawerOpen && state.currentBenchId) {
          updateDrawerDistance();
        }
      },
      function(error) {
        if (error.code === error.PERMISSION_DENIED) {
          setStorage('locationDenied', 'true');
          showNotification('Location permission denied. Please enable in browser settings.', 'error', 5000);
        } else {
          showNotification('Could not get location', 'error');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }

  function updateDrawerDistance() {
    if (!state.currentBenchId) return;
    
    const bench = state.allBenches.find(b => b.id === state.currentBenchId);
    if (!bench) return;
    
    const distance = state.userLocation ? state.map.distance(state.userLocation, bench.latlng) : null;
    state.currentBenchDistance = distance;
    
    // Update the distance display
    const distanceEl = document.querySelector('.drawer-distance-container');
    if (distanceEl && distance) {
      distanceEl.innerHTML = `<div class="drawer-distance">📍 ${formatDistance(distance)} from you</div>`;
    }
  }

  // ====== MAP INIT ======
  function initMap() {
    console.log('initMap called');
    
    // Check for URL parameters (for deep linking from Bench of the Day)
    const urlParams = new URLSearchParams(window.location.search);
    const lat = urlParams.get('lat');
    const lng = urlParams.get('lng');
    const zoom = urlParams.get('zoom');
    
    // Use URL params if provided, otherwise use defaults
    const initialCenter = (lat && lng) ? [parseFloat(lat), parseFloat(lng)] : CONFIG.MAP_CENTER;
    const initialZoom = zoom ? parseInt(zoom) : CONFIG.MAP_ZOOM;
    
    console.log('Map initial center:', initialCenter, 'initial zoom:', initialZoom);
    
    state.map = L.map('map', { 
      center: initialCenter, 
      zoom: initialZoom, 
      minZoom: 5, 
      maxZoom: 18,
      maxBounds: CONFIG.MAP_BOUNDS,
      maxBoundsViscosity: 1.0,
      zoomControl: true,
      doubleClickZoom: true
    });
    
    console.log('Map created, actual zoom:', state.map.getZoom());
    
    L.esri.Vector.vectorBasemapLayer('arcgis/colored-pencil', {
      token: 'AAPTaJGdwJQD8Bx4HmZmixY27Ng..JrjSudd8QgX-zj8OnYXhWcXOnohmGJ0PuphYNEkzQaEclm3t_GTF1dNVWHB2Ooqg2ZmwSEZAFYd79nzC5yrxpkMsQZGj-e8ZxOe2BnQDQOOZNo6N763rnS9-oHZ4btZbQJl3Yfv9Wk-tcAa-zCblAZc8-d1_jcq1QKYdcCHXfZALIRX046_5g0ukwdghDsUrv6QPIBFGJOInXemkGLrqheXRS1Tp65rb2gkNciZkQOP6xHsRMa78zO-_JgM.AT1_1xkHlFSl'
    }).addTo(state.map);
    
    state.markerCluster = L.markerClusterGroup({ 
      maxClusterRadius: CONFIG.CLUSTER_RADIUS, 
      disableClusteringAtZoom: CONFIG.CLUSTER_DISABLE_AT_ZOOM,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        let className = 'marker-cluster-small';
        if (count > 10) className = 'marker-cluster-medium';
        if (count > 50) className = 'marker-cluster-large';
        
        return L.divIcon({
          html: '<div><span>' + count + '</span></div>',
          className: 'marker-cluster ' + className,
          iconSize: L.point(40, 40)
        });
      }
    });
    
    state.map.addLayer(state.markerCluster);
    
    // If URL params provided, don't fit to bounds (we want to zoom to specific location)
    if (!lat || !lng) {
      state.map.fitBounds(CONFIG.MAP_BOUNDS);
      console.log('After fitBounds, zoom level:', state.map.getZoom());
      // Removed forced minimum zoom - let fitBounds decide the best zoom for UK view
    }
    
    // Store URL params for later use (to open drawer after benches load)
    if (lat && lng) {
      state.urlBenchCoords = { lat: parseFloat(lat), lng: parseFloat(lng) };
    }
    
    state.map.on('dragend', loadVisibleTiles);
    state.map.on('zoomend', loadVisibleTiles);
    
    // Ensure map size is correct (important for mobile)
    setTimeout(() => {
      console.log('Calling invalidateSize and loadVisibleTiles (mobile fix)');
      state.map.invalidateSize();
      loadVisibleTiles();
    }, 100);
  }

  // ====== TILE LOADING (Fixed) ======
  function checkAndOpenUrlBench() {
    // Check if we have URL coordinates to open
    if (!state.urlBenchCoords) return;
    
    const targetLat = state.urlBenchCoords.lat;
    const targetLng = state.urlBenchCoords.lng;
    
    // Find the bench closest to these coordinates
    let closestBench = null;
    let minDistance = Infinity;
    
    state.allBenches.forEach(bench => {
      const distance = Math.sqrt(
        Math.pow(bench.latlng[0] - targetLat, 2) + 
        Math.pow(bench.latlng[1] - targetLng, 2)
      );
      
      if (distance < minDistance) {
        minDistance = distance;
        closestBench = bench;
      }
    });
    
    // If we found a very close bench (within ~100 meters), open it
    if (closestBench && minDistance < 0.001) {
      console.log('Opening bench from URL:', closestBench.id);
      setTimeout(() => {
        openDrawer(closestBench.id);
      }, 500);
      
      // Clear the flag so we don't try again
      state.urlBenchCoords = null;
    }
  }

  function getTileKey(row, col) {
    return `${row}_${col}`;
  }

  function loadVisibleTiles() {
    if (state.isFetching) return;
    const bounds = state.map.getBounds();
    const zoom = state.map.getZoom();
    
    console.log('loadVisibleTiles called - zoom:', zoom, 'bounds:', bounds);
    
    if (zoom < 5) {
      console.log('Zoom too low (<5), skipping tile load');
      return;
    }

    const latRange = CONFIG.MAP_BOUNDS[1][0] - CONFIG.MAP_BOUNDS[0][0];
    const lngRange = CONFIG.MAP_BOUNDS[1][1] - CONFIG.MAP_BOUNDS[0][1];
    const latPerTile = latRange / CONFIG.TILE_ROWS;
    const lngPerTile = lngRange / CONFIG.TILE_COLS;

    const startRow = Math.max(0, Math.floor((bounds.getSouth() - CONFIG.MAP_BOUNDS[0][0]) / latPerTile));
    const endRow = Math.min(CONFIG.TILE_ROWS - 1, Math.floor((bounds.getNorth() - CONFIG.MAP_BOUNDS[0][0]) / latPerTile));
    const startCol = Math.max(0, Math.floor((bounds.getWest() - CONFIG.MAP_BOUNDS[0][1]) / lngPerTile));
    const endCol = Math.min(CONFIG.TILE_COLS - 1, Math.floor((bounds.getEast() - CONFIG.MAP_BOUNDS[0][1]) / lngPerTile));

    const tilesToLoad = [];
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        const key = getTileKey(r, c);
        if (!state.tilesLoaded.has(key) && CONFIG.EXISTING_TILES.has(key)) {
          tilesToLoad.push({ row: r, col: c, key });
        }
      }
    }

    if (tilesToLoad.length === 0) return;

    state.isFetching = true;

    // Fetch tiles in small batches to avoid saturating mobile connections.
    // All-at-once Promise.all can fire 50+ requests simultaneously on UK overview zoom.
    const BATCH_SIZE = 4;
    var allResults = [];

    function fetchNextBatch(startIndex) {
      var batch = tilesToLoad.slice(startIndex, startIndex + BATCH_SIZE);
      if (batch.length === 0) {
        // All batches done — add to map and release lock
        allResults.forEach(function(r) {
          if (r.data && r.data.features) {
            console.log(`Adding ${r.data.features.length} benches from tile ${r.tile.row}_${r.tile.col}`);
            addBenchesToMap(r.data.features);
            state.tilesLoaded.add(r.tile.key);
          }
        });
        console.log(`Total benches now: ${state.allBenches.length}`);
        checkAndOpenUrlBench();
        state.isFetching = false;
        // Re-check visible area — the map may have moved while we were fetching
        loadVisibleTiles();
        return;
      }

      var batchPromises = batch.map(function(tile) {
        var url = CONFIG.GITHUB_TILE_BASE + tile.row + '_' + tile.col + '.geojson';
        return fetch(url)
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(data) { return { tile: tile, data: data }; })
          .catch(function() { return { tile: tile, data: null }; });
      });

      Promise.all(batchPromises).then(function(results) {
        allResults = allResults.concat(results);
        fetchNextBatch(startIndex + BATCH_SIZE);
      }).catch(function() {
        state.isFetching = false;
      });
    }

    fetchNextBatch(0);
  }

  function addBenchesToMap(features) {
    console.log(`addBenchesToMap called with ${features.length} features`);
    // Collect all new markers, then add in one bulk operation.
    // addLayers() (plural) recalculates clusters once — calling addLayer() in a
    // loop recalculates on every single marker and freezes mobile browsers.
    const newMarkers = [];
    features.forEach(f => {
      try {
        const coords = f.geometry.coordinates;
        const latlng = [coords[1], coords[0]];
        const props = f.properties || {};
        const benchId = props.id || `bench_${coords[1]}_${coords[0]}`;

        if (state.markerRefs[benchId]) return;

        const tags = getTagsFromProps(props);
        const icon = getMarkerIconForTags(tags, state.favorites.has(benchId));
        const marker = L.marker(latlng, { icon });
        marker.bindPopup(() => createCompactPopupContent(props, benchId));
        marker.on('click', () => openDrawer(benchId));

        state.allBenches.push({ id: benchId, latlng, marker, props, tags });
        state.markerRefs[benchId] = marker;

        // If a tag filter is active, only add if this bench matches
        if (!state.activeTagFilter || tags.includes(state.activeTagFilter)) {
          newMarkers.push(marker);
        }
      } catch (err) {
        console.warn('Skipped bad bench feature:', err);
      }
    });

    // Single bulk insert — far more efficient than individual addLayer calls
    if (newMarkers.length > 0) {
      state.markerCluster.addLayers(newMarkers);
    }
    console.log(`Total markers in cluster: ${state.markerCluster.getLayers().length}`);
  }

  function createCompactPopupContent(props, id) {
    // Escape user-supplied strings — popup content is rendered via innerHTML.
    const conversationTopic = escapeHtml(props.conversation_topic || '');
    const rawTopic = props.topic || props.inscription || '';
    // Truncate the raw value first, then escape — slicing escaped HTML can split entities.
    const topic = escapeHtml(rawTopic.length > 50 ? rawTopic.substring(0, 50) + '...' : rawTopic);
    const material = escapeHtml(props.material || '');

    let content = '<div style="font-family: Nunito, sans-serif; min-width: 150px;">';

    // Conversation topic badge (prominent)
    if (conversationTopic) {
      content += `<div style="background: linear-gradient(135deg, #4A7A4A 0%, #3A5F3A 100%); color: white; padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; font-weight: 700; font-size: 13px; text-align: center;">🗣️ ${conversationTopic}</div>`;
    }
    
    content += '<strong style="color: #3A5F3A; font-size: 15px; display: inline-flex; align-items: center; gap: 5px;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="15" height="15" fill="#3A5F3A" style="flex-shrink:0;"><path d="M27.5,7l-23,0l0,-1c-0,-0.276 -0.224,-0.5 -0.5,-0.5c-0.276,0 -0.5,0.224 -0.5,0.5l0,10.5l-1.5,-0c-0.276,0 -0.5,0.224 -0.5,0.5l0,3.5c0,0.276 0.224,0.5 0.5,0.5l1,-0l0,5c-0,0.276 0.224,0.5 0.5,0.5c0.276,0 0.5,-0.224 0.5,-0.5l0,-5l24,-0l0,5c-0,0.276 0.224,0.5 0.5,0.5c0.276,0 0.5,-0.224 0.5,-0.5l0,-5l1,-0c0.276,-0 0.5,-0.224 0.5,-0.5l0,-3.5c0,-0.276 -0.224,-0.5 -0.5,-0.5l-1.5,-0l0,-10.5c-0,-0.276 -0.224,-0.5 -0.5,-0.5c-0.276,0 -0.5,0.224 -0.5,0.5l0,1Zm-23,6.5l0,3l23,-0l0,-3l-23,-0Z"/></svg> Bench</strong><br>';
    
    if (topic) {
      content += `<div style="margin: 6px 0; font-size: 13px; color: #555;">${topic}</div>`;
    }
    if (material) {
      content += `<div style="margin: 4px 0; font-size: 12px; color: #888;">Material: ${material}</div>`;
    }
    
    content += '<button onclick="window.benchApp.openDrawer(\'' + id + '\')" ';
    content += 'style="margin-top: 8px; padding: 6px 12px; background: #4A7A4A; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600;">View details</button>';
    content += '</div>';
    
    return content;
  }

  // ====== DRAWER ======
  function getUserRatingKey(benchId, category) {
    return `rating_${benchId}_${category}`;
  }

  // Bench SVG path reused throughout the drawer UI
  var DRAWER_BENCH_PATH = 'M27.5,7l-23,0l0,-1c-0,-0.276 -0.224,-0.5 -0.5,-0.5c-0.276,0 -0.5,0.224 -0.5,0.5l0,10.5l-1.5,-0c-0.276,0 -0.5,0.224 -0.5,0.5l0,3.5c0,0.276 0.224,0.5 0.5,0.5l1,-0l0,5c-0,0.276 0.224,0.5 0.5,0.5c0.276,0 0.5,-0.224 0.5,-0.5l0,-5l24,-0l0,5c-0,0.276 0.224,0.5 0.5,0.5c0.276,0 0.5,-0.224 0.5,-0.5l0,-5l1,-0c0.276,-0 0.5,-0.224 0.5,-0.5l0,-3.5c0,-0.276 -0.224,-0.5 -0.5,-0.5l-1.5,-0l0,-10.5c-0,-0.276 -0.224,-0.5 -0.5,-0.5c-0.276,0 -0.5,0.224 -0.5,0.5l0,1Zm-23,6.5l0,3l23,-0l0,-3l-23,-0Z';

  function createDrawerContent(props, benchId, distance) {
    // Escape every user-supplied string before injecting into innerHTML.
    // Drawer content is rendered via innerHTML, so untrusted props would otherwise be an XSS vector.
    const conversationTopic = escapeHtml(props.conversation_topic || '');
    const topic = escapeHtml(props.topic || props.inscription || '').replace(/\r\n|\r|\n/g, '<br>');
    // Use empty string instead of 'Unknown' so we can hide rows with no data
    const material = escapeHtml(props.material || '');
    const backrest = escapeHtml(props.backrest || '');
    const seats    = escapeHtml(props.seats    || '');
    const colour   = escapeHtml(props.colour   || '');
    const notes    = escapeHtml(props.notes    || '');
    const safeBenchId = escapeHtml(benchId);
    const tags = getTagsFromProps(props);

    // Filter out properties we're showing in main section
    const mainProps = new Set(['conversation_topic', 'community_tags', 'topic', 'inscription', 'material', 'backrest', 'seats', 'colour', 'notes', 'id', 'source', 'openbenches_id']);
    const additionalProps = Object.entries(props)
      .filter(([key, value]) => !mainProps.has(key) && value && value !== 'Unknown' && value !== '')
      .sort(([a], [b]) => a.localeCompare(b));

    let html = `
      <div class="drawer-header">
        <h2 class="drawer-title"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="20" height="20" fill="currentColor" style="flex-shrink:0;" aria-hidden="true"><path d="M27.5,7l-23,0l0,-1c-0,-0.276 -0.224,-0.5 -0.5,-0.5c-0.276,0 -0.5,0.224 -0.5,0.5l0,10.5l-1.5,-0c-0.276,0 -0.5,0.224 -0.5,0.5l0,3.5c0,0.276 0.224,0.5 0.5,0.5l1,-0l0,5c-0,0.276 0.224,0.5 0.5,0.5c0.276,0 0.5,-0.224 0.5,-0.5l0,-5l24,-0l0,5c-0,0.276 0.224,0.5 0.5,0.5c0.276,0 0.5,-0.224 0.5,-0.5l0,-5l1,-0c0.276,-0 0.5,-0.224 0.5,-0.5l0,-3.5c0,-0.276 -0.224,-0.5 -0.5,-0.5l-1.5,-0l0,-10.5c-0,-0.276 -0.224,-0.5 -0.5,-0.5c-0.276,0 -0.5,0.224 -0.5,0.5l0,1Zm-23,6.5l0,3l23,-0l0,-3l-23,-0Z"/></svg> Bench details</h2>
        <button class="drawer-close" onclick="window.benchApp.closeDrawer()" aria-label="Close drawer">×</button>
      </div>
      <div class="drawer-body-content">
    `;

    // Community tag chips — shown prominently at the top
    if (tags.length > 0) {
      html += `<div class="bench-tags">`;
      tags.forEach(function(tagId) {
        const tagDef = CONFIG.BENCH_TAGS.find(function(t) { return t.id === tagId; });
        if (!tagDef) return;
        html += `<span class="tag-chip" style="border-color:${tagDef.color}55;background:${tagDef.color}22;color:${tagDef.color}"><span aria-hidden="true">${tagDef.emoji}</span> ${tagDef.label}</span>`;
      });
      html += `</div>`;
    }

    // Conversation topic banner (shown when bench is tagged chatty with a topic)
    if (conversationTopic) {
      html += `
        <div class="conversation-topic-banner">
          <div class="conversation-topic-icon" aria-hidden="true">💬</div>
          <div class="conversation-topic-content">
            <div class="conversation-topic-label">Conversation topic</div>
            <div class="conversation-topic-text">${conversationTopic}</div>
            <div class="conversation-topic-hint">Join the conversation — strangers welcome!</div>
          </div>
        </div>
      `;
    }

    // Memorial inscription
    if (topic) {
      const obId = props.openbenches_id ? escapeHtml(String(props.openbenches_id)) : '';
      const obLink = obId
        ? `<a class="ob-attribution" href="https://openbenches.org/bench/${obId}" target="_blank" rel="noopener">View on OpenBenches</a>`
        : '';
      html += `
        <div class="inscription-banner">
          <span class="inscription-icon" aria-hidden="true">🕊️</span>
          <span class="inscription-body">
            <span class="inscription-text">${topic}</span>
            ${obLink}
          </span>
        </div>
      `;
    }

    // "People here today" live counter
    html += `<div id="checkins-today-${benchId}"></div>`;

    // ====== PHOTOS ======
    // Approved photos render here (populated by fetchBenchPhotos after the drawer opens).
    // Anyone can upload; uploads land in 'pending' state and only appear after moderation.
    html += `
      <div class="drawer-section drawer-photos-section">
        <div id="photo-gallery-${benchId}" class="photo-gallery" aria-live="polite"></div>
        <div class="photo-footer">
          <button class="photo-upload-btn" type="button"
                  onclick="window.benchApp.startPhotoUpload('${safeBenchId}')"
                  aria-label="Add a photo of this bench">
            <span class="photo-upload-icon" aria-hidden="true">📷</span>
            <span id="photo-upload-label-${benchId}">Add a photo</span>
          </button>
          <div id="photo-upload-status-${benchId}" class="photo-upload-status" role="status" aria-live="polite"></div>
        </div>
      </div>
    `;

    const detailRows = [
      material ? `<div class="drawer-info-item"><span class="drawer-label">Material:</span><span class="drawer-value">${material}</span></div>` : '',
      backrest ? `<div class="drawer-info-item"><span class="drawer-label">Backrest:</span><span class="drawer-value">${backrest}</span></div>` : '',
      seats    ? `<div class="drawer-info-item"><span class="drawer-label">Seats:</span><span class="drawer-value">${seats}</span></div>` : '',
      colour   ? `<div class="drawer-info-item"><span class="drawer-label">Colour:</span><span class="drawer-value">${colour}</span></div>` : '',
      notes    ? `<div class="drawer-info-item"><span class="drawer-label">Notes:</span><span class="drawer-value">${notes}</span></div>` : '',
    ].filter(Boolean).join('');

    html += `
        ${detailRows ? `<div class="drawer-info">${detailRows}</div>` : ''}
        </div>

        <div class="drawer-distance-container">
          ${distance ? `
            <div class="drawer-distance">📍 ${formatDistance(distance)} from you</div>
          ` : !state.userLocation ? `
            <button class="drawer-enable-location-btn" onclick="window.benchApp.requestLocation()">
              📍 Enable location to see distance
            </button>
          ` : ''}
        </div>
    `;

    // Directions + Share row
    html += `
        <div class="drawer-directions-section">
          <button class="drawer-action-btn drawer-action-btn-directions" onclick="window.benchApp.getRoute('${safeBenchId}')">
            <span class="icon">🚶</span>
            <span>Get walking directions</span>
          </button>
          <button class="drawer-action-btn drawer-action-btn-share" onclick="window.benchApp.shareBench('${safeBenchId}')">
            <span class="icon">🔗</span>
            <span>Share</span>
          </button>
        </div>
    `;
    
    // Rating section
    html += `<div class="drawer-section"><h3 class="drawer-section-title">Rate this bench</h3>`;
    
    CONFIG.RATING_CATEGORIES.forEach(cat => {
      const storedRating = getStorage(getUserRatingKey(benchId, cat));
      const alreadyRated = !!storedRating;
      const userRatingValue = parseInt(storedRating, 10) || 0;
      const icon = cat === 'comfort' ? '🛋️' : cat === 'ambience' ? '🌳' : '👁️';
      const label = cat.charAt(0).toUpperCase() + cat.slice(1);
      const statusClass = alreadyRated ? 'completed' : 'pending';
      const statusText = alreadyRated ? '✓ Rated ' + userRatingValue + '/5' : 'Tap to rate';
      const disabledClass = alreadyRated ? ' disabled' : '';

      html += `
        <div id="row-${cat}-${benchId}" class="drawer-rating-row${alreadyRated ? ' rated' : ''}">
          <div class="rating-row-top">
            <div class="rating-label-improved">
              <span class="icon" aria-hidden="true">${icon}</span>
              <span>${label}</span>
            </div>
            <span class="rating-status ${statusClass}">${statusText}</span>
          </div>
          <div id="rating-stars-${cat}-${benchId}" class="star-rating-improved${disabledClass}"
               role="radiogroup" aria-label="${label} rating">
            ${[1,2,3,4,5].map(i => `<span role="radio"
              aria-checked="${alreadyRated && i <= userRatingValue ? 'true' : 'false'}"
              tabindex="${alreadyRated ? -1 : (i === 1 ? 0 : -1)}"
              aria-label="${i} star${i > 1 ? 's' : ''}"
              class="star${alreadyRated && i <= userRatingValue ? ' active' : ''}"
              data-value="${i}">★</span>`).join('')}
          </div>
          <div id="avg-${cat}-${benchId}" class="rating-average">
            <span class="loading">Loading...</span>
          </div>
        </div>
      `;
    });
    
    html += `</div>`;
    
    // Action buttons
    html += `
      <div class="drawer-actions">
        <button id="fav-btn-${benchId}" class="drawer-action-btn" onclick="window.benchApp.toggleFavorite('${safeBenchId}')">
          <span class="icon">☆</span>
          <span>Favourite</span>
        </button>
        <button id="checkin-btn-${benchId}" class="drawer-action-btn" onclick="window.benchApp.checkIn('${safeBenchId}')">
          <span class="icon">📍</span>
          <span>Check in</span>
        </button>
        <button class="drawer-action-btn" onclick="window.benchApp.clearRoute()">
          <span class="icon">🗺️</span>
          <span>Clear route</span>
        </button>
      </div>
    `;
    
    // ====== COMMUNITY TAG PICKER ======
    html += `
      <div class="drawer-section">
        <h3 class="drawer-section-title">Tag this bench</h3>
        <p class="tag-picker-hint">Let others know what makes this bench special.</p>
        <div class="tag-picker" id="tag-picker-${benchId}">
    `;
    CONFIG.BENCH_TAGS.forEach(function(tag) {
      const isActive = tags.includes(tag.id);
      html += `<button class="tag-toggle-chip${isActive ? ' active' : ''}"
        data-tag="${tag.id}"
        style="--tag-color:${tag.color}"
        onclick="window.benchApp.toggleTagChip(this)"
        aria-pressed="${isActive}"
        title="${tag.desc}"
      ><span aria-hidden="true">${tag.emoji}</span> ${tag.label}</button>`;
    });
    html += `
        </div>
        <button class="save-tags-btn" id="save-tags-btn-${benchId}"
                onclick="window.benchApp.saveBenchCommunityTags('${safeBenchId}')">
          Save tags
        </button>
        <div id="tag-save-status-${benchId}" class="tag-save-status"></div>
      </div>
    `;

    // Additional information section (collapsible)
    if (additionalProps.length > 0) {
      html += `
        <div class="additional-info-section">
          <button 
            class="additional-info-toggle" 
            onclick="window.benchApp.toggleAdditionalInfo('${safeBenchId}')"
            aria-expanded="false"
            aria-controls="additional-info-${benchId}"
          >
            <span class="additional-info-icon">ℹ️</span>
            <span class="additional-info-title">Additional information</span>
            <span class="additional-info-count">(${additionalProps.length})</span>
            <span class="additional-info-arrow">▼</span>
          </button>
          <div id="additional-info-${benchId}" class="additional-info-content" style="display: none;">
      `;
      
      additionalProps.forEach(([key, value]) => {
        const displayKey = escapeHtml(
          key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        );
        const safeValue = escapeHtml(value);
        html += `
          <div class="additional-prop-item">
            <span class="additional-prop-key">${displayKey}:</span>
            <span class="additional-prop-value">${safeValue}</span>
          </div>
        `;
      });
      
      html += `
          </div>
        </div>
      `;
    }
    
    html += `</div>`;
    return html;
  }

  function toggleAdditionalInfo(benchId) {
    const content = document.getElementById(`additional-info-${benchId}`);
    const toggle = document.querySelector(`[aria-controls="additional-info-${benchId}"]`);
    
    if (!content || !toggle) return;
    
    const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
    
    if (isExpanded) {
      content.style.display = 'none';
      toggle.setAttribute('aria-expanded', 'false');
    } else {
      content.style.display = 'block';
      toggle.setAttribute('aria-expanded', 'true');
    }
  }

  function initDrawer() {
    document.getElementById('drawerOverlay')?.addEventListener('click', closeDrawer);
    
    // Handle swipe down to close on mobile
    let startY = 0;
    const drawerContent = document.querySelector('.drawer-content');
    
    drawerContent?.addEventListener('touchstart', e => {
      startY = e.touches[0].clientY;
    });
    
    drawerContent?.addEventListener('touchmove', e => {
      const currentY = e.touches[0].clientY;
      const diff = currentY - startY;
      // Only close if swiping down AND the drawer content is scrolled to the top
      if (diff > 50 && drawerContent.scrollTop === 0) {
        closeDrawer();
      }
    });
  }

  function openDrawer(benchId) {
    const bench = state.allBenches.find(function(b) {
      return b.id === benchId;
    });

    if (!bench) {
      console.error('Bench not found:', benchId);
      return;
    }

    if (state.isMenuOpen) closeMenu();

    state.focusedBeforeDrawer = document.activeElement;
    state.drawerOpen = true;
    state.isMenuOpen = false;
    state.currentBenchId = benchId;

    const distance = state.userLocation ? state.map.distance(state.userLocation, bench.latlng) : null;
    state.currentBenchDistance = distance;

    const drawer = document.getElementById('benchDrawer');
    const drawerBody = document.getElementById('drawerBody');

    drawerBody.innerHTML = createDrawerContent(bench.props, benchId, distance);
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');

    // Move focus to the close button so keyboard users know the drawer is open
    const closeBtn = drawer.querySelector('.drawer-close');
    if (closeBtn) closeBtn.focus();

    // Temporarily change marker to highlight
    const originalIcon = bench.marker.options.icon;
    bench.marker.setIcon(icons.highlight);
    bench.marker._originalIcon = originalIcon;

    // Setup interactions after content is added
    setTimeout(function() {
      setupStarRatings(benchId);
      updateFavoriteButton(benchId);
      updateCheckInButton(benchId);
      fetchCheckInsToday(benchId);
      fetchBenchCommunityTags(benchId);  // overlay any Firestore tags on top of OSM-derived ones
      fetchBenchPhotos(benchId);         // load approved photos into the gallery
    }, 10);

    // Close any open popups
    state.map.closePopup();
  }

  function closeDrawer() {
    const drawer = document.getElementById('benchDrawer');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');

    // Restore original marker icon
    if (state.currentBenchId) {
      const bench = state.allBenches.find(function(b) {
        return b.id === state.currentBenchId;
      });

      if (bench && bench.marker && bench.marker._originalIcon) {
        bench.marker.setIcon(bench.marker._originalIcon);
        delete bench.marker._originalIcon;
      }
    }

    state.drawerOpen = false;
    state.isMenuOpen = false;
    state.currentBenchId = null;
    state.currentBenchDistance = null;

    // Return focus to the element that triggered the drawer
    if (state.focusedBeforeDrawer && typeof state.focusedBeforeDrawer.focus === 'function') {
      state.focusedBeforeDrawer.focus();
    }
    state.focusedBeforeDrawer = null;
  }

  function createMenuDrawerContent() {
    const total = state.allBenches.length;
    const favs = state.favorites.size;
    const visited = state.visitedBenches.size;
    const pct = total ? Math.round((visited / total) * 100) : 0;
    
    // Get filter states
    const filterActiveClass = state.filterActive ? ' active' : '';
    const filterButtonText = state.filterActive ? '✓ Showing top rated' : 'Show top rated only';
    
    return `
      <div class="menu-header">
        <h2 class="menu-title">Menu</h2>
        <button class="drawer-close" onclick="window.benchApp.closeMenu()" aria-label="Close menu">×</button>
      </div>
      <div class="menu-section">
        <h3 class="menu-section-title"><span aria-hidden="true">⚡</span>Quick actions</h3>
        <div class="menu-quick-actions">
          <button id="filterBtnMenu" class="menu-action-btn${filterActiveClass}" onclick="window.benchApp.toggleFilter()">
            <span class="menu-action-icon">🔍</span>
            <span>${filterButtonText}</span>
          </button>
        </div>
      </div>
      <div class="menu-section"><h3 class="menu-section-title"><span aria-hidden="true">📊</span>Your statistics</h3>
        <div class="stats-grid-menu">
          <div class="stat-card-menu"><div class="stat-value-menu">${total}</div><div class="stat-label-menu">Total benches</div></div>
          <div class="stat-card-menu"><div class="stat-value-menu">${favs}</div><div class="stat-label-menu">Favorites</div></div>
          <div class="stat-card-menu"><div class="stat-value-menu">${visited}</div><div class="stat-label-menu">Visited</div></div>
          <div class="stat-card-menu"><div class="stat-value-menu">${pct}%</div><div class="stat-label-menu">Completion</div></div>
        </div>
      </div>
      <div class="menu-section"><h3 class="menu-section-title"><span aria-hidden="true">🔗</span>Navigation</h3>
        <div class="menu-links">
          <a href="bench-of-the-day.html" class="menu-link-btn"><span class="menu-link-icon" aria-hidden="true">🪑</span><span>Bench of the day</span></a>
          <a href="about.html" class="menu-link-btn"><span class="menu-link-icon" aria-hidden="true">ℹ️</span><span>About Bench Map UK</span></a>
        </div>
      </div>
    `;
  }

  function openMenu() {
    if (state.drawerOpen && !state.isMenuOpen) closeDrawer();
    state.isMenuOpen = true;
    state.drawerOpen = true;
    const drawer = document.getElementById('benchDrawer');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.getElementById('drawerBody').innerHTML = createMenuDrawerContent();
  }

  function closeMenu() { 
    if (state.isMenuOpen) {
      closeDrawer(); 
    }
  }

  function initMenu() {
    // menuBtn is now the filter button — handled entirely by initFilterBar()
  }

  // ====== FAVORITE / VISITED ======
  function toggleFavorite(id) {
    if (state.favorites.has(id)) state.favorites.delete(id);
    else state.favorites.add(id);
    saveUserData();
    const marker = state.markerRefs[id];
    if (marker) marker.setIcon(state.favorites.has(id) ? icons.favorite : icons.bench);
    showNotification('Favorite updated');
    updateFavoriteButton(id);
  }

  function updateFavoriteButton(id) {
    const btn = document.getElementById('fav-btn-' + id);
    if (!btn) return;
    const isFav = state.favorites.has(id);
    btn.className = 'drawer-action-btn' + (isFav ? ' active' : '');
    btn.innerHTML = '<span class="icon">' + (isFav ? '⭐' : '☆') + '</span><span>' + (isFav ? 'Favorited' : 'Favorite') + '</span>';
  }

  function toggleVisited(id) {
    if (state.visitedBenches.has(id)) state.visitedBenches.delete(id);
    else state.visitedBenches.add(id);
    saveUserData();
    updateCheckInButton(id);
  }

  function checkIn(id) {
    if (state.visitedBenches.has(id)) return;
    
    // Add to local storage immediately
    state.visitedBenches.add(id);
    saveUserData();
    updateCheckInButton(id);
    
    // Save to Firebase if available
    if (state.db) {
      const sanitizedId = sanitizeBenchId(id);
      const checkInId = sanitizedId + '_' + Date.now();
      
      state.db.collection('benchCheckIns').doc(checkInId).set({
        benchId: sanitizedId,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      }).then(() => {
        showNotification('Checked in!', 'success');
      }).catch(err => {
        console.error('Check-in failed to save to Firebase:', err);
        showNotification('Checked in locally!', 'info');
      });
    } else {
      showNotification('Checked in locally!', 'info');
    }
  }

  function updateCheckInButton(id) {
    const btn = document.getElementById('checkin-btn-' + id);
    if (!btn) return;
    const isVisited = state.visitedBenches.has(id);
    btn.className = 'drawer-action-btn' + (isVisited ? ' active' : '');
    btn.innerHTML = '<span class="icon">' + (isVisited ? '✓' : '📍') + '</span><span>' + (isVisited ? 'Visited' : 'Check in') + '</span>';
    btn.disabled = isVisited;
  }

  // ====== RATING ======
  function setupStarRatings(benchId) {
    CONFIG.RATING_CATEGORIES.forEach(cat => {
      const alreadyRated = !!getStorage(getUserRatingKey(benchId, cat));
      const container = document.getElementById('rating-stars-' + cat + '-' + benchId);
      if (!container) return;

      fetchAverageRating(benchId, cat);

      if (alreadyRated) return;

      const stars = Array.from(container.querySelectorAll('.star'));

      function moveFocus(index) {
        stars.forEach((s, j) => s.setAttribute('tabindex', j === index ? '0' : '-1'));
        stars[index].focus();
      }

      stars.forEach((star, i) => {
        star.addEventListener('click', () => {
          submitRating(benchId, cat, i + 1);
        });
        star.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            submitRating(benchId, cat, i + 1);
          } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            moveFocus(Math.min(i + 1, stars.length - 1));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            moveFocus(Math.max(i - 1, 0));
          }
        });
        star.addEventListener('mouseenter', () => {
          for (let j = 0; j <= i; j++) stars[j].classList.add('hover');
        });
        star.addEventListener('mouseleave', () => {
          stars.forEach(s => s.classList.remove('hover'));
        });
      });
    });
  }

  function submitRating(benchId, category, value) {
    if (!state.db) { showNotification('Rating unavailable offline', 'error'); return; }

    const sanitizedBenchId = sanitizeBenchId(benchId);
    const docRef = state.db.collection('benchRatings').doc(sanitizedBenchId);

    // Use FieldValue.increment for atomic updates — no transaction needed,
    // avoids the read+write precondition that caused permission-denied errors.
    const increment = firebase.firestore.FieldValue.increment;
    docRef.set({
      [category]: {
        total: increment(value),
        count: increment(1)
      }
    }, { merge: true }).then(() => {
      setStorage(getUserRatingKey(benchId, category), String(value));
      showNotification('Rating saved!', 'success');
      const row = document.getElementById('row-' + category + '-' + benchId);
      const container = document.getElementById('rating-stars-' + category + '-' + benchId);
      if (row) row.classList.add('rated');
      if (container) {
        container.classList.add('disabled');
        container.querySelectorAll('.star').forEach(function(star, i) {
          if (i < value) { star.classList.add('active'); star.setAttribute('aria-checked', 'true'); }
          else           { star.classList.remove('active'); star.setAttribute('aria-checked', 'false'); }
          star.setAttribute('tabindex', '-1');
        });
      }
      const statusEl = row?.querySelector('.rating-status');
      if (statusEl) statusEl.outerHTML = '<span class="rating-status completed">✓ Rated ' + value + '/5</span>';
      fetchAverageRating(benchId, category);
    }).catch(err => {
      console.error('Rating failed:', err);
      showNotification('Rating failed', 'error');
    });
  }

  function fetchAverageRating(benchId, category) {
    if (!state.db) return;
    
    const sanitizedBenchId = sanitizeBenchId(benchId);
    
    state.db.collection('benchRatings')
      .doc(sanitizedBenchId)
      .get()
      .then(doc => {
        if (!doc.exists || !doc.data()[category]) {
          updateAverageDisplay(benchId, category, null, 0);
          return;
        }
        
        const categoryData = doc.data()[category];
        const avg = categoryData.count > 0 ? categoryData.total / categoryData.count : 0;
        updateAverageDisplay(benchId, category, avg, categoryData.count);
      })
      .catch(err => {
        console.error('Failed to fetch rating:', err);
        updateAverageDisplay(benchId, category, null, 0);
      });
  }

  function updateAverageDisplay(benchId, category, avg, count) {
    const el = document.getElementById('avg-' + category + '-' + benchId);
    if (!el) return;
    if (avg === null || count === 0) {
      el.innerHTML = '<span class="no-ratings">No ratings yet</span>';
    } else {
      const stars = '★'.repeat(Math.round(avg));
      el.innerHTML = '<span class="avg-stars">' + stars + '</span><span class="avg-value">' + avg.toFixed(1) + '</span><span class="avg-count">(' + count + ')</span>';
    }
  }

  // ====== ADD BENCH ======
  function initAddBenchFeature() {
    const fab = document.getElementById('addBenchFab');
    if (!fab) return;
    fab.setAttribute('aria-pressed', 'false');
    fab.addEventListener('click', () => {
      state.addingBench = !state.addingBench;
      fab.classList.toggle('active');
      fab.setAttribute('aria-pressed', state.addingBench ? 'true' : 'false');
      const hint = document.getElementById('addBenchHint');
      if (state.addingBench) {
        hint?.classList.add('show');
        showNotification('Tap on the map to add a bench');
        state.map.once('click', onMapClickAddBench);
      } else {
        hint?.classList.remove('show');
        state.map.off('click', onMapClickAddBench);
      }
    });
  }

  function onMapClickAddBench(e) {
    if (!state.addingBench) return;
    const latlng = e.latlng;
    if (state.newBenchMarker) state.map.removeLayer(state.newBenchMarker);
    state.newBenchMarker = L.marker(latlng, { icon: icons.newBench }).addTo(state.map);
    
    // Open form in drawer instead of simple prompt
    showAddBenchForm(latlng);
  }
  
  function showAddBenchForm(latlng) {
    const drawer = document.getElementById('benchDrawer');
    const drawerBody = document.getElementById('drawerBody');

    state.drawerOpen = true;
    state.isMenuOpen = false;
    state.currentBenchId = null;  // clear any stale bench reference
    
    const tagChipsHtml = CONFIG.BENCH_TAGS.map(function(tag) {
      return `<button type="button" class="tag-select-btn" data-tag="${tag.id}"
                onclick="window.benchApp.toggleFormTag('${tag.id}')"
                style="--tag-color:${tag.color}">
                <span class="tag-select-emoji">${tag.emoji}</span>
                <span class="tag-select-label">${tag.label}</span>
                <span class="tag-select-desc">${tag.desc}</span>
              </button>`;
    }).join('');

    drawerBody.innerHTML = `
      <div class="drawer-header">
        <h2 class="drawer-title">✨ Add new bench</h2>
        <button class="drawer-close" onclick="window.benchApp.cancelAddBench()" aria-label="Close">×</button>
      </div>
      <div class="drawer-body-content">
        <div class="add-bench-form">
          <p class="form-intro">Help the Bench Map UK community by tagging this bench. Every tag helps someone discover it!</p>

          <div class="form-section">
            <h3 class="form-section-title">🏷️ What makes this bench special?</h3>
            <p class="form-description">Select all that apply:</p>
            <div class="tag-select-grid">${tagChipsHtml}</div>
          </div>

          <div class="form-section" id="conversationTopicSection" style="display:none">
            <h3 class="form-section-title">💬 Conversation topic</h3>
            <p class="form-description">What subject can passers-by join in on?</p>
            <input type="text" id="conversationTopic" class="form-input" placeholder="e.g., Chess strategy, Sci-fi books, Dog training..." maxlength="100" />
          </div>
          
          <div class="form-section">
            <h3 class="form-section-title">📝 Basic information</h3>
            
            <label class="form-label">
              <span class="label-text">Memorial inscription (if any)</span>
              <input type="text" id="inscription" class="form-input" placeholder="In memory of..." maxlength="200" />
            </label>
            
            <label class="form-label">
              <span class="label-text">Material</span>
              <select id="material" class="form-select">
                <option value="">Select material...</option>
                <option value="wood">Wood</option>
                <option value="metal">Metal</option>
                <option value="stone">Stone</option>
                <option value="concrete">Concrete</option>
                <option value="plastic">Plastic</option>
                <option value="mixed">Mixed materials</option>
                <option value="other">Other</option>
              </select>
            </label>
            
            <label class="form-label">
              <span class="label-text">Number of seats</span>
              <select id="seats" class="form-select">
                <option value="">Select...</option>
                <option value="1">1 person</option>
                <option value="2">2 people</option>
                <option value="3">3 people</option>
                <option value="4">4 people</option>
                <option value="5+">5+ people</option>
              </select>
            </label>
            
            <label class="form-label">
              <span class="label-text">Has backrest?</span>
              <select id="backrest" class="form-select">
                <option value="">Select...</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            
            <label class="form-label">
              <span class="label-text">Colour</span>
              <input type="text" id="colour" class="form-input" placeholder="e.g., Brown, Green, Grey..." maxlength="50" />
            </label>
            
            <label class="form-label">
              <span class="label-text">Additional notes (optional)</span>
              <textarea id="notes" class="form-textarea" placeholder="Any other details about this bench..." maxlength="300" rows="3"></textarea>
            </label>
          </div>
          
          <div class="form-actions">
            <button class="form-btn form-btn-primary" onclick="window.benchApp.submitAddBenchForm()">
              ✨ Add bench
            </button>
            <button class="form-btn form-btn-secondary" onclick="window.benchApp.cancelAddBench()">
              Cancel
            </button>
          </div>
        </div>
      </div>
    `;
    
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    
    // Store latlng for later
    state.pendingBenchLocation = latlng;
    
    // Scroll to top of drawer form
    setTimeout(() => {
      const dc = document.querySelector('.drawer-content');
      if (dc) dc.scrollTop = 0;
    }, 100);
  }
  
  function submitAddBenchForm() {
    const conversationTopic = document.getElementById('conversationTopic')?.value.trim() || '';
    const inscription = document.getElementById('inscription')?.value.trim() || '';
    const material = document.getElementById('material')?.value || '';
    const seats = document.getElementById('seats')?.value || '';
    const backrest = document.getElementById('backrest')?.value || '';
    const colour = document.getElementById('colour')?.value.trim() || '';
    const notes = document.getElementById('notes')?.value.trim() || '';

    // Collect selected community tags
    const selectedTags = Array.from(document.querySelectorAll('.tag-select-btn.active'))
      .map(function(btn) { return btn.dataset.tag; });

    const benchData = {
      community_tags: selectedTags,
      conversation_topic: conversationTopic,
      topic: inscription,
      inscription: inscription,
      material: material,
      seats: seats,
      backrest: backrest,
      colour: colour,
      notes: notes
    };

    saveNewBench(state.newBenchMarker, state.pendingBenchLocation, benchData);
  }
  
  function cancelAddBench() {
    // Remove the temporary marker
    if (state.newBenchMarker) {
      state.map.removeLayer(state.newBenchMarker);
      state.newBenchMarker = null;
    }
    
    // Reset add bench mode
    state.addingBench = false;
    document.getElementById('addBenchFab')?.classList.remove('active');
    const hint = document.getElementById('addBenchHint');
    if (hint) hint.classList.remove('show');
    
    // Close drawer
    closeDrawer();
    
    // Clear pending location
    state.pendingBenchLocation = null;
  }

  function saveNewBench(marker, latlng, benchData) {
    if (!state.db) {
      showNotification('Database not available', 'error');
      return;
    }
    if (!latlng) {
      showNotification('Location data missing. Please tap the map again to place the bench.', 'error');
      return;
    }
    if (!marker) {
      showNotification('Marker missing. Please try again.', 'error');
      return;
    }

    showNotification('Saving bench...', 'info', 1000);

    const id = sanitizeBenchId('manual_' + latlng.lat.toFixed(6) + '_' + latlng.lng.toFixed(6));
    
    // Prepare data for Firebase
    const firestoreData = {
      lat: latlng.lat,
      lng: latlng.lng,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    // Add all fields from benchData
    if (benchData.community_tags && benchData.community_tags.length > 0) firestoreData.community_tags = JSON.stringify(benchData.community_tags);
    if (benchData.conversation_topic) firestoreData.conversation_topic = benchData.conversation_topic;
    if (benchData.topic) firestoreData.topic = benchData.topic;
    if (benchData.inscription) firestoreData.inscription = benchData.inscription;
    if (benchData.material) firestoreData.material = benchData.material;
    if (benchData.seats) firestoreData.seats = benchData.seats;
    if (benchData.backrest) firestoreData.backrest = benchData.backrest;
    if (benchData.colour) firestoreData.colour = benchData.colour;
    if (benchData.notes) firestoreData.notes = benchData.notes;
    
    state.db.collection('newBenches').doc(id).set(firestoreData).then(() => {
      // Create props object with all the data
      const props = { ...benchData };
      const tags = getTagsFromProps(props);
      marker.setIcon(getMarkerIconForTags(tags, false));

      marker.bindPopup(() => createCompactPopupContent(props, id));
      marker.on('click', () => openDrawer(id));

      state.allBenches.push({ id, latlng: [latlng.lat, latlng.lng], marker, props, tags });
      state.markerRefs[id] = marker;

      // Remove from direct map layer before handing to MarkerCluster —
      // calling addLayer() on a marker that already has a _map reference
      // causes a Leaflet error in some cluster versions.
      if (state.map.hasLayer(marker)) state.map.removeLayer(marker);
      state.markerCluster.addLayer(marker);
      
      showNotification('Bench added successfully!', 'success');
      
      // Reset add bench mode
      state.addingBench = false;
      document.getElementById('addBenchFab')?.classList.remove('active');
      const hint = document.getElementById('addBenchHint');
      if (hint) hint.classList.remove('show');
      
      // Close drawer
      closeDrawer();
      
      // Clear temporary marker reference
      state.newBenchMarker = null;
      state.pendingBenchLocation = null;
    }).catch(err => {
      console.error('Firebase save error:', err);
      console.error('Error code:', err.code);
      console.error('Error message:', err.message);
      
      // More specific error messages
      if (err.code === 'permission-denied') {
        showNotification('Could not save bench — permission denied.', 'error', 5000);
      } else if (err.code === 'unavailable') {
        showNotification('Database temporarily unavailable. Try again.', 'error', 5000);
      } else {
        showNotification('Save failed: ' + err.message, 'error', 5000);
      }
    });
  }

  // ====== SEARCH WITH AUTOCOMPLETE ======
  let searchTimeout;
  let currentSuggestions = [];
  let currentInscriptionResults = [];
  
  function initSearch() {
    const pill       = document.getElementById('searchPill');
    const input      = document.getElementById('searchInput');
    const btn        = document.getElementById('searchBtn');
    const toggleBtn  = document.getElementById('searchToggleBtn');
    if (!pill || !input || !btn) return;

    function expandPill() {
      pill.classList.add('expanded');
      input.focus();
    }
    function collapsePill() {
      if (!input.value.trim()) {
        pill.classList.remove('expanded');
        hideSuggestions();
      }
    }

    // Search icon expands the pill
    if (toggleBtn) {
      toggleBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (pill.classList.contains('expanded')) {
          if (input.value.trim()) {
            geocode(input.value.trim());
          } else {
            collapsePill();
          }
        } else {
          expandPill();
        }
      });
    }

    // Collapse on blur if empty
    input.addEventListener('blur', () => setTimeout(collapsePill, 150));

    btn.addEventListener('click', () => geocode(input.value.trim()));
    input.addEventListener('keypress', e => {
      if (e.key === 'Enter') { geocode(input.value.trim()); hideSuggestions(); }
    });

    input.addEventListener('input', e => {
      const query = e.target.value.trim();
      clearTimeout(searchTimeout);
      if (query.length < 2) { hideSuggestions(); return; }
      searchTimeout = setTimeout(() => fetchSuggestions(query), 300);
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#searchPill')) {
        hideSuggestions();
        collapsePill();
      }
    });
  }
  
  // Words that start sentences in memorial inscriptions but are not names
  var INSCRIPTION_STOP_WORDS = new Set([
    'A','An','The','In','Of','To','For','By','At','On','And','Or','With','From',
    'His','Her','Their','Our','My','Who','Where','This','That','These','Those',
    'Is','Was','Are','Were','Has','Have','Had','Will','Would','Shall','Should',
    'May','Might','Can','Could','Do','Does','Did','Be','Being','Been',
    'It','Its','He','She','They','We','You','I',
    'Beloved','Dear','Loving','Loved','Memorial','Memory','Remembrance',
    'Honour','Honor','Dedicated','Erected','Placed','Given','Donated',
    'Treasured','Missed','Friend','Husband','Wife','Father','Mother',
    'Son','Daughter','Brother','Sister','Grandfather','Grandmother',
    'Partner','Companion','Always','Forever','Much','Dearly','Rest','Here'
  ]);

  function extractInscriptionNames(text) {
    var names = [];
    var current = [];
    text.split(/\s+/).forEach(function(token) {
      var word = token.replace(/[^a-zA-Z'-]/g, '');
      if (!word) {
        if (current.length) { names.push(current.join(' ')); current = []; }
        return;
      }
      if (/^[A-Z]/.test(word) && !INSCRIPTION_STOP_WORDS.has(word)) {
        current.push(word);
      } else {
        if (current.length) { names.push(current.join(' ')); current = []; }
      }
    });
    if (current.length) names.push(current.join(' '));
    return names.join(' ').toLowerCase();
  }

  function searchInscriptions(query) {
    if (!state.inscriptionIndex || query.length < 2) return [];
    var q = query.toLowerCase();
    var results = [];
    for (var i = 0; i < state.inscriptionIndex.length; i++) {
      var entry = state.inscriptionIndex[i];
      var names = extractInscriptionNames(entry[2]);
      if (names && names.includes(q)) {
        results.push(entry);
        if (results.length >= 3) break;
      }
    }
    return results;
  }

  function fetchSuggestions(query) {
    var inscriptionResults = searchInscriptions(query);
    // Show inscription results immediately while Nominatim responds
    if (inscriptionResults.length > 0) {
      renderSuggestions([], inscriptionResults);
    }
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', UK')}&format=json&limit=5`)
      .then(r => r.json())
      .then(data => {
        renderSuggestions(data && data.length > 0 ? data : [], inscriptionResults);
      })
      .catch(err => {
        console.error('Suggestion fetch error:', err);
        if (inscriptionResults.length === 0) hideSuggestions();
      });
  }

  function renderSuggestions(locationSuggestions, inscriptionResults) {
    currentSuggestions = locationSuggestions;
    currentInscriptionResults = inscriptionResults;

    if (locationSuggestions.length === 0 && inscriptionResults.length === 0) {
      hideSuggestions();
      return;
    }

    let dropdown = document.getElementById('searchSuggestions');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'searchSuggestions';
      dropdown.className = 'search-suggestions';
      document.getElementById('searchPill').appendChild(dropdown);
    }

    var html = locationSuggestions.map((item, index) => {
      const displayName = escapeHtml(item.display_name.split(',').slice(0, 3).join(','));
      return `<div class="suggestion-item" data-type="location" data-index="${index}">${displayName}</div>`;
    }).join('');

    if (inscriptionResults.length > 0) {
      if (locationSuggestions.length > 0) {
        html += `<div class="suggestion-divider">Memorial benches</div>`;
      }
      html += inscriptionResults.map((entry, index) => {
        const ins = entry[2];
        const preview = ins.length > 52 ? ins.substring(0, 52) + '…' : ins;
        return `<div class="suggestion-item suggestion-item-bench" data-type="inscription" data-index="${index}"><span class="suggestion-bench-icon" aria-hidden="true">🕊️</span>${escapeHtml(preview)}</div>`;
      }).join('');
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.getAttribute('data-type');
        const index = parseInt(item.getAttribute('data-index'));
        if (type === 'location') {
          const suggestion = currentSuggestions[index];
          if (suggestion) {
            state.map.flyTo([suggestion.lat, suggestion.lon], 14);
            document.getElementById('searchInput').value = suggestion.display_name.split(',')[0];
            hideSuggestions();
            showNotification('Found: ' + suggestion.display_name.split(',')[0]);
          }
        } else if (type === 'inscription') {
          const entry = currentInscriptionResults[index];
          if (entry) {
            const [lat, lng, ins] = entry;
            state.map.flyTo([lat, lng], 17);
            document.getElementById('searchInput').value = '';
            hideSuggestions();
          }
        }
      });
    });
  }
  
  function hideSuggestions() {
    const dropdown = document.getElementById('searchSuggestions');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
  }

  function geocode(query) {
    if (!query) return;
    showNotification('Searching...');
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ', UK')}&format=json&limit=1`)
      .then(r => r.json())
      .then(data => {
        if (data[0]) {
          state.map.flyTo([data[0].lat, data[0].lon], 14);
          showNotification('Found: ' + data[0].display_name.split(',')[0]);
        } else {
          showNotification('Not found', 'warning');
        }
      });
  }

  // ====== NEAREST BENCH ======
  function findNearestBench() {
    if (!navigator.geolocation) { showNotification('Geolocation not supported', 'error'); return; }
    showNotification('Locating...');
    state.map.locate({ setView: true, maxZoom: 16, timeout: 10000 });

    // Handle geolocation failure (permission denied, timeout, unavailable)
    state.map.once('locationerror', function(e) {
      console.error('Location error:', e.message);
      if (e.code === 1) {
        showNotification('Location permission denied — please enable in browser settings', 'error', 5000);
      } else if (e.code === 3) {
        showNotification('Location request timed out — please try again', 'error', 4000);
      } else {
        showNotification('Could not get your location', 'error', 4000);
      }
    });

    state.map.once('locationfound', e => {
      // Clear the error handler now that we have a location
      state.map.off('locationerror');
      state.userLocation = e.latlng;
      
      // Update user location marker
      if (state.userLocationMarker) {
        state.map.removeLayer(state.userLocationMarker);
      }
      if (state.userAccuracyCircle) {
        state.map.removeLayer(state.userAccuracyCircle);
      }
      
      state.userLocationMarker = L.marker(state.userLocation, { 
        icon: icons.userLocation 
      })
        .addTo(state.map)
        .bindPopup("📍 Your location");
      
      if (e.accuracy && e.accuracy < 1000) {
        state.userAccuracyCircle = L.circle(state.userLocation, {
          radius: e.accuracy,
          color: '#C85A40',
          fillColor: '#C85A40',
          fillOpacity: 0.1,
          weight: 1,
          opacity: 0.3
        }).addTo(state.map);
      }
      
      showNotification('Loading nearby benches...', 'info', 2000);

      // Trigger tile loading for the current view (map is now centred on the user at zoom 16)
      loadVisibleTiles();

      // Poll until tile fetching is complete (or timeout after ~6 s), then find nearest
      function waitAndFind(attemptsLeft) {
        if (state.isFetching && attemptsLeft > 0) {
          setTimeout(function() { waitAndFind(attemptsLeft - 1); }, 300);
          return;
        }

        let nearest = null, minDist = Infinity;
        state.allBenches.forEach(function(b) {
          const d = state.map.distance(state.userLocation, b.latlng);
          if (d < minDist) { minDist = d; nearest = b; }
        });

        if (nearest) {
          state.map.flyTo(nearest.latlng, 17);
          setTimeout(function() { openDrawer(nearest.id); }, 600);
          showNotification('Nearest: ' + formatDistance(minDist) + ' away', 'success');
        } else {
          showNotification('No benches found nearby', 'warning');
        }
      }

      waitAndFind(20); // up to 20 × 300 ms = 6 s
    });
  }

  // ====== ROUTING ======
  function getRoute(benchId) {
    console.log('getRoute called with benchId:', benchId);
    const bench = state.allBenches.find(b => b.id === benchId);
    
    if (!bench) {
      console.error('Bench not found for id:', benchId);
      showNotification('Bench not found', 'error');
      return;
    }
    
    console.log('Found bench:', bench);
    console.log('Bench latlng:', bench.latlng);
    
    // Close the popup when directions are clicked
    state.map.closePopup();
    
    if (!state.userLocation) {
      console.log('No user location, requesting...');
      showNotification('Getting your location...', 'info');
      
      if (!navigator.geolocation) {
        console.error('Geolocation not supported');
        showNotification('Geolocation not supported by your browser', 'error');
        return;
      }
      
      navigator.geolocation.getCurrentPosition(
        function(position) {
          console.log('Got position:', position);
          state.userLocation = L.latLng(position.coords.latitude, position.coords.longitude);
          console.log('User location set to:', state.userLocation);
          
          // Add user location marker if not already present
          if (state.userLocationMarker) {
            state.map.removeLayer(state.userLocationMarker);
          }
          if (state.userAccuracyCircle) {
            state.map.removeLayer(state.userAccuracyCircle);
          }
          
          state.userLocationMarker = L.marker(state.userLocation, { icon: icons.userLocation })
            .addTo(state.map)
            .bindPopup("📍 Your location");
          
          if (position.coords.accuracy && position.coords.accuracy < 1000) {
            state.userAccuracyCircle = L.circle(state.userLocation, {
              radius: position.coords.accuracy,
              color: '#C85A40',
              fillColor: '#C85A40',
              fillOpacity: 0.1,
              weight: 1,
              opacity: 0.3
            }).addTo(state.map);
          }
          
          // Convert bench latlng array to LatLng object
          const benchLatLng = Array.isArray(bench.latlng) 
            ? L.latLng(bench.latlng[0], bench.latlng[1])
            : bench.latlng;
          
          console.log('Calling drawRoute with:', state.userLocation, benchLatLng);
          drawRoute(state.userLocation, benchLatLng);
        },
        function(error) {
          console.error('Geolocation error:', error);
          let errorMsg = 'Location unavailable';
          switch(error.code) {
            case error.PERMISSION_DENIED:
              errorMsg = 'Location permission denied - please enable in browser settings';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMsg = 'Location information unavailable';
              break;
            case error.TIMEOUT:
              errorMsg = 'Location request timed out';
              break;
          }
          showNotification(errorMsg, 'error', 5000);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    } else {
      console.log('User location already known:', state.userLocation);
      // Convert bench latlng array to LatLng object
      const benchLatLng = Array.isArray(bench.latlng) 
        ? L.latLng(bench.latlng[0], bench.latlng[1])
        : bench.latlng;
      
      console.log('Calling drawRoute with:', state.userLocation, benchLatLng);
      drawRoute(state.userLocation, benchLatLng);
    }
  }

  function drawRoute(startLatlng, endLatlng) {
    console.log('drawRoute called');
    console.log('Start:', startLatlng);
    console.log('End:', endLatlng);
    
    // Remove existing route
    if (state.routeLayer) {
      state.map.removeLayer(state.routeLayer);
    }
    
    // Ensure we have proper lat/lng values
    const startLat = startLatlng.lat;
    const startLng = startLatlng.lng;
    const endLat = endLatlng.lat;
    const endLng = endLatlng.lng;
    
    console.log('Coordinates:', { startLat, startLng, endLat, endLng });
    
    if (startLat == null || startLng == null || endLat == null || endLng == null ||
        isNaN(startLat) || isNaN(startLng) || isNaN(endLat) || isNaN(endLng)) {
      console.error('Invalid coordinates');
      showNotification('Invalid coordinates', 'error');
      return;
    }
    
    const url = 'https://router.project-osrm.org/route/v1/foot/' + 
      startLng + ',' + startLat + ';' + 
      endLng + ',' + endLat + 
      '?geometries=geojson&overview=full';

    console.log('Fetching route from:', url);
    showNotification('Finding route...', 'info', 1000);
    
    fetch(url)
      .then(function(response) {
        console.log('Route response status:', response.status);
        if (!response.ok) {
          throw new Error('Routing service unavailable (HTTP ' + response.status + ')');
        }
        return response.json();
      })
      .then(function(data) {
        console.log('Route data:', data);
        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0].geometry;
          const distance = data.routes[0].distance;
          const duration = data.routes[0].duration;
          
          console.log('Route found:', { distance, duration });
          
          state.routeLayer = L.geoJSON(route, {
            style: {
              color: '#03A9F4',
              weight: 5,
              opacity: 0.8
            }
          }).addTo(state.map);
          
          state.map.fitBounds(state.routeLayer.getBounds(), { padding: [50, 50] });
          
          const walkTime = Math.round(duration / 60);
          showNotification('Route: ' + formatDistance(distance) + ' • ' + walkTime + ' min walk', 'success', 5000);
          
          // Close drawer so user can see the route
          closeDrawer();
        } else {
          console.error('No routes in response');
          showNotification('Could not find route', 'error');
        }
      })
      .catch(function(error) {
        console.error('Routing error:', error);
        showNotification('Route failed: ' + error.message, 'error');
      });
  }

  function clearRoute() {
    if (state.routeLayer) {
      state.map.removeLayer(state.routeLayer);
      state.routeLayer = null;
      showNotification('Route cleared', 'info');
    }
  }

  // ====== KEYBOARD SHORTCUTS ======
  function initKeyboardShortcuts() {
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); document.getElementById('searchInput')?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); document.getElementById('addBenchFab')?.click(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') { e.preventDefault(); findNearestBench(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); toggleFilter(); }
      if (e.key === 'Escape') { if (state.drawerOpen) closeDrawer(); else if (state.addingBench) document.getElementById('addBenchFab')?.click(); }
    });
  }

  // ====== FILTER FUNCTIONALITY ======
  function toggleFilter() {
    state.filterActive = !state.filterActive;
    
    // Update menu button if it exists (when menu is open)
    const filterBtnMenu = document.getElementById('filterBtnMenu');
    
    if (state.filterActive) {
      filterBtnMenu?.classList.add('active');
      applyFilter();
    } else {
      filterBtnMenu?.classList.remove('active');
      clearFilter();
    }
    
    // Refresh menu if it's open to update button state
    if (state.isMenuOpen) {
      document.getElementById('drawerBody').innerHTML = createMenuDrawerContent();
    }
  }

  function applyFilter() {
    if (!state.db) {
      showNotification('Filter requires online connection', 'warning');
      state.filterActive = false;
      const filterBtnMenu = document.getElementById('filterBtnMenu');
      filterBtnMenu?.classList.remove('active');
      return;
    }

    showNotification('Finding best rated benches...', 'info', 2000);
    
    // Get all bench IDs that we have loaded
    const loadedBenchIds = state.allBenches.map(b => sanitizeBenchId(b.id));
    const qualifyingBenches = new Set();
    
    // Fetch all benchRatings in one query (much more efficient!)
    state.db.collection('benchRatings')
      .get()
      .then(snapshot => {
        if (snapshot.empty) {
          showNotification('No rated benches found yet. Be the first to rate!', 'info', 4000);
          state.filterActive = false;
          const filterBtnMenu = document.getElementById('filterBtnMenu');
          filterBtnMenu?.classList.remove('active');
          return;
        }
        
        snapshot.forEach(doc => {
          const benchId = doc.id;
          const data = doc.data();
          
          // Only process if this bench is currently loaded on the map
          if (!loadedBenchIds.includes(benchId)) return;
          
          // Calculate average across all categories
          let categoriesWithRatings = 0;
          let totalScore = 0;
          const categoryScores = [];
          
          CONFIG.RATING_CATEGORIES.forEach(cat => {
            if (data[cat] && data[cat].count >= CONFIG.MIN_RATING_COUNT) {
              categoriesWithRatings++;
              const avg = data[cat].total / data[cat].count;
              totalScore += avg;
              categoryScores.push(avg);
            }
          });
          
          // Qualify if bench has ratings in at least 2 categories with good average
          // OR has 1 category with excellent rating (4.5+)
          if (categoriesWithRatings >= 2) {
            const overallAvg = totalScore / categoriesWithRatings;
            if (overallAvg >= 3.5) {
              qualifyingBenches.add(benchId);
            }
          } else if (categoriesWithRatings === 1 && categoryScores[0] >= 4.5) {
            qualifyingBenches.add(benchId);
          }
        });
        
        finishFilter(qualifyingBenches);
      })
      .catch(err => {
        console.error('Filter error:', err);
        showNotification('Filter failed', 'error');
        state.filterActive = false;
        const filterBtnMenu = document.getElementById('filterBtnMenu');
        filterBtnMenu?.classList.remove('active');
      });
  }

  function finishFilter(qualifyingBenches) {
    console.log(`Filter complete: ${qualifyingBenches.size} benches qualify out of ${state.allBenches.length} total`);
    
    // Hide all markers that don't qualify
    state.allBenches.forEach(bench => {
      const sanitizedId = sanitizeBenchId(bench.id);
      
      if (qualifyingBenches.has(sanitizedId)) {
        // Show this marker
        if (!state.markerCluster.hasLayer(bench.marker)) {
          state.markerCluster.addLayer(bench.marker);
        }
      } else {
        // Hide this marker
        state.markerCluster.removeLayer(bench.marker);
      }
    });
    
    if (qualifyingBenches.size > 0) {
      showNotification(`Showing ${qualifyingBenches.size} best rated benches (3.5+ stars)`, 'success', 4000);
    } else {
      showNotification('No rated benches found yet. Be the first to rate!', 'info', 4000);
      // Turn off filter since nothing to show
      state.filterActive = false;
      const filterBtnMenu = document.getElementById('filterBtnMenu');
      filterBtnMenu?.classList.remove('active');
    }
    
    // Refresh menu if it's open to update button state
    if (state.isMenuOpen) {
      document.getElementById('drawerBody').innerHTML = createMenuDrawerContent();
    }
  }

  function clearFilter() {
    // Show all markers again
    state.allBenches.forEach(bench => {
      if (!state.markerCluster.hasLayer(bench.marker)) {
        state.markerCluster.addLayer(bench.marker);
      }
    });
    showNotification('Filter cleared - showing all benches', 'info');
  }

  // ====== LOAD USER-ADDED BENCHES FROM FIRESTORE ======
  // The GitHub GeoJSON tiles only contain OSM data. Benches added via the app
  // are stored in Firestore and must be loaded separately so all visitors see them.
  function loadUserAddedBenches() {
    if (!state.db) return;

    state.db.collection('newBenches').get()
      .then(function(snapshot) {
        if (snapshot.empty) return;

        var features = [];
        snapshot.forEach(function(doc) {
          var data = doc.data();
          if (data.lat == null || data.lng == null) return;

          // Reconstruct a GeoJSON-style feature from the Firestore document
          features.push({
            geometry: {
              coordinates: [data.lng, data.lat]
            },
            properties: Object.assign({}, data, {
              id: doc.id,
              // Parse community_tags back from JSON string if needed
              community_tags: (function() {
                if (!data.community_tags) return [];
                if (Array.isArray(data.community_tags)) return data.community_tags;
                try { return JSON.parse(data.community_tags); } catch { return []; }
              })()
            })
          });
        });

        if (features.length > 0) {
          console.log('Loading ' + features.length + ' user-added benches from Firestore');
          addBenchesToMap(features);
        }
      })
      .catch(function(err) {
        console.error('Failed to load user-added benches:', err);
        // Non-fatal — the OSM tile data still loads normally
      });
  }

  // ====== INIT ======
  function init() {
    initFirebase();
    initMap();
    initDrawer();
    initMenu();
    initAddBenchFeature();
    initSearch();
    initFilterBar();
    initPhotoLightbox();
    document.getElementById('nearestBtn')?.addEventListener('click', findNearestBench);
    initKeyboardShortcuts();

    // Load inscription index for search (non-blocking)
    fetch('/data/inscription_index.json')
      .then(r => r.json())
      .then(data => { state.inscriptionIndex = data; })
      .catch(() => {});

    // Load user-submitted benches from Firestore after Firebase is ready
    // (slight delay to let Firebase auth settle)
    setTimeout(function() {
      loadUserAddedBenches();
    }, 500);

    // Delay location request to let map and tiles load first
    setTimeout(() => {
      initUserLocation();
    }, 1000);

    // If the user grants location permission after the initial request times out
    // (e.g. while reading the welcome overlay), zoom to their location then.
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(function(status) {
        status.onchange = function() {
          if (status.state === 'granted' && !state.userLocation) {
            setStorage('locationDenied', 'false');
            initUserLocation();
          }
        };
      }).catch(function() {});
    }

    setTimeout(hideLoader, CONFIG.LOADER_FADE_DELAY);

    // Show welcome overlay on first visit
    showWelcomeOverlay();

    console.log('Bench Map UK ready');
  }

  const $ = id => document.getElementById(id);
  window.benchApp = {
    openDrawer,
    closeDrawer,
    toggleFavorite,
    toggleVisited,
    checkIn,
    openMenu,
    closeMenu,
    getRoute,
    clearRoute,
    toggleFilter,
    toggleAdditionalInfo,
    requestLocation,
    dismissLocationNotice,
    submitAddBenchForm,
    cancelAddBench,
    shareBench,
    dismissWelcome,
    filterByTag,
    toggleFormTag,
    toggleTagChip,
    saveBenchCommunityTags,
    startPhotoUpload,
    openPhotoLightbox,
    closePhotoLightbox,
    carouselNav
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
