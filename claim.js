/* Catalyst Claim Journey — campaign engine shared across chapters */
(function () {
  var KEY = "catalyst_claim";
  var STATS_KEY = "catalyst_claim_stats";

  var FIRST = ["James","Sarah","Mohammed","Emma","David","Priya","Tom","Grace","Olawale","Ruth","Liam","Aisha","Daniel","Chloe","Raj"];
  var LAST  = ["Hughes","Patel","Smith","Okafor","Khan","Brown","Wilson","Ahmed","Taylor","Evans","Jones","Walsh","Begum","Clarke","Singh"];
  var AREAS = ["Delph","Saddleworth","Uppermill","Oldham","Rochdale","Stockport","Ashton-under-Lyne","Greenfield","Diggle"];

  var PERILS = [
    { id:"eow",   name:"Escape of Water",   icon:"💧", sev:[1,3], symptom:"There's water coming through my kitchen ceiling and the upstairs carpet is soaking wet.", loc:"bathroom" },
    { id:"drain", name:"Blocked Drain",     icon:"🕳️", sev:[1,2], symptom:"The downstairs toilet is gurgling and the drain cover outside is overflowing.", loc:"drain" },
    { id:"mains", name:"Mains Supply Leak", icon:"🚰", sev:[2,3], symptom:"Water's bubbling up through the driveway and our pressure has dropped right off.", loc:"mains" },
    { id:"storm", name:"Storm Damage",      icon:"⛈️", sev:[2,3], symptom:"Last night's storm tore off some roof tiles and now it's dripping into the loft.", loc:"roof" },
    { id:"subs",  name:"Subsidence",        icon:"🏚️", sev:[1,3], symptom:"Cracks have appeared above the windows and the floor feels like it's sloping.", loc:"walls" }
  ];

  function rnd(a){ return a[Math.floor(Math.random()*a.length)]; }
  function clamp(v){ return Math.max(0, Math.min(100, Math.round(v))); }
  function load(){ try { return JSON.parse(localStorage.getItem(KEY)); } catch(e){ return null; } }
  function save(d){ localStorage.setItem(KEY, JSON.stringify(d)); }
  function perilById(id){ for(var i=0;i<PERILS.length;i++) if(PERILS[i].id===id) return PERILS[i]; return PERILS[0]; }
  function active(){ var d=load(); return !!(d && d.stage && d.stage!=="result" && d.stage!=="done"); }
  function inChapter(stage){ var d=load(); return !!(d && d.stage===stage) && new URLSearchParams(location.search).has("claim"); }

  function start(){
    var p = rnd(PERILS);
    var sev = p.sev[0] + Math.floor(Math.random()*(p.sev[1]-p.sev[0]+1));
    var d = {
      id: 1000 + Math.floor(Math.random()*9000),
      customer: rnd(FIRST)+" "+rnd(LAST),
      area: rnd(AREAS),
      peril: p.id, perilName: p.name, perilIcon: p.icon, symptom: p.symptom, correctLoc: p.loc,
      severity: sev,
      value: 1800 + Math.floor(Math.random()*78)*100,
      excess: 150 + Math.floor(Math.random()*8)*50,
      csat: 72,
      stage: "setup", stages: {}, startedAt: Date.now()
    };
    save(d);
    location.href = "claim-setup.html";
  }

  function completeSetup(r){
    var d=load(); if(!d) return;
    d.stages.setup = r;
    d.csat = clamp(d.csat + (r.csatDelta||0));
    d.stage = "dispatch"; save(d);
    location.href = "game3-dispatch.html?claim=1";
  }
  function completeDispatch(r){
    var d=load(); if(!d) return;
    d.stages.dispatch = r;
    d.csat = clamp(d.csat - (r.missed||0)*6 + (r.stars>=3?6:0));
    d.stage = "repair"; save(d);
    location.href = "game1-water-leak.html?claim=1";
  }
  function completeRepair(r){
    var d=load(); if(!d) return;
    d.stages.repair = r;
    d.csat = clamp(d.csat + (r.stars>=3?8 : r.stars>=2?3 : -5));
    d.stage = "result"; save(d);
    location.href = "claim-result.html";
  }

  function stageStars(s){ return (s && typeof s.stars==="number") ? s.stars : 0; }

  function summary(){
    var d=load(); if(!d) return null;
    var s=d.stages||{};
    var stars = [stageStars(s.setup), stageStars(s.dispatch), stageStars(s.repair)];
    var avg = (stars[0]+stars[1]+stars[2]) / 3;
    var grade = avg>=2.6 ? "A" : avg>=2.0 ? "B" : avg>=1.3 ? "C" : "D";
    var gradeLabel = {A:"Outstanding",B:"Solid",C:"Needs work",D:"Poor"}[grade];
    var efficiency = 0.55 + (avg/3)*0.45;
    var profit = Math.round(d.value * 0.2 * efficiency / 10) * 10;
    var minutes = Math.max(1, Math.round((Date.now()-d.startedAt)/60000));
    var csat = d.csat;
    var testimonial = csat>=85 ? "Absolutely first class from start to finish — couldn't fault them." :
                      csat>=70 ? "Professional and sorted the problem quickly. Happy with the service." :
                      csat>=50 ? "Job got done, though communication could have been better." :
                                 "Took longer than I'd have liked and I felt out of the loop.";
    // persist lifetime stats
    var st; try { st = JSON.parse(localStorage.getItem(STATS_KEY)) || {claims:0,profit:0,stars:0}; } catch(e){ st={claims:0,profit:0,stars:0}; }
    if(!d.counted){ st.claims++; st.profit+=profit; st.stars+=(stars[0]+stars[1]+stars[2]); d.counted=true; save(d); localStorage.setItem(STATS_KEY, JSON.stringify(st)); }
    return { d:d, stars:stars, avg:avg, grade:grade, gradeLabel:gradeLabel, profit:profit, minutes:minutes, csat:csat, testimonial:testimonial, stats:st };
  }

  function finish(){ var d=load(); if(d){ d.stage="done"; save(d); } }
  function reset(){ localStorage.removeItem(KEY); }

  // Chapter progress banner — call from any chapter page.
  function mountBanner(el, currentStage){
    if (typeof el === "string") el = document.getElementById(el);
    var d=load(); if(!el || !d) return;
    var steps = [["setup","Setup"],["dispatch","Dispatch"],["repair","Repair"]];
    var order = {setup:0,dispatch:1,repair:2,result:3,done:3};
    var cur = order[currentStage];
    var dots = steps.map(function(s,i){
      var state = i<cur ? "done" : (i===cur ? "now" : "todo");
      var col = state==="done" ? "#34d399" : state==="now" ? "#36C5F0" : "rgba(255,255,255,.25)";
      var mark = state==="done" ? "✓" : (i+1);
      return '<span style="display:inline-flex;align-items:center;gap:5px">' +
        '<span style="width:18px;height:18px;border-radius:50%;background:'+col+';color:#06182e;font-size:11px;font-weight:800;display:inline-flex;align-items:center;justify-content:center">'+mark+'</span>' +
        '<span style="font-size:11px;font-weight:700;color:'+(state==="now"?"#eaf1fb":"#7e94b2")+'">'+s[1]+'</span></span>' +
        (i<2 ? '<span style="flex:1;height:2px;background:rgba(255,255,255,.12);margin:0 6px;border-radius:2px"></span>' : '');
    }).join("");
    el.innerHTML =
      '<div style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:10px 14px;backdrop-filter:blur(12px)">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12.5px">' +
          '<span style="font-size:16px">'+d.perilIcon+'</span>' +
          '<b style="color:#eaf1fb">Claim #'+d.id+'</b>' +
          '<span style="color:#9fb0c8">· '+d.customer+' · '+d.area+'</span>' +
          '<span style="margin-left:auto;color:#36C5F0;font-weight:700">'+d.perilName+'</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center">'+dots+'</div>' +
      '</div>';
  }

  window.Claim = {
    PERILS: PERILS, perilById: perilById,
    start: start, load: load, save: save, active: active, inChapter: inChapter,
    completeSetup: completeSetup, completeDispatch: completeDispatch, completeRepair: completeRepair,
    summary: summary, finish: finish, reset: reset, mountBanner: mountBanner
  };
})();
