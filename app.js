// Calendar Hours: parses .ics in the browser, totals hours per event title. No network calls.
(function(){
function unfold(t){return t.replace(/\r\n/g,"\n").replace(/\n[ \t]/g,"");}
function parseDT(v,params){ // returns {ms, allDay} treating wall-clock as UTC-ish for duration math
  var m=v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/); if(!m) return null;
  var allDay=!m[4]||/VALUE=DATE(?!-)/.test(params||"");
  return {ms:Date.UTC(+m[1],m[2]-1,+m[3],+(m[4]||0),+(m[5]||0),+(m[6]||0)),allDay:allDay};
}
function parseDur(d){var m=d.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);if(!m)return 0;
  return (m[1]=="-"?-1:1)*(((+m[2]||0)*7+(+m[3]||0))*864e5+(+m[4]||0)*36e5+(+m[5]||0)*6e4+(+m[6]||0)*1e3);}
var DAYS=["SU","MO","TU","WE","TH","FR","SA"];
function expand(ev,rangeEnd){
  if(!ev.rrule) return [ev.start];
  var r={};ev.rrule.split(";").forEach(function(p){var kv=p.split("=");r[kv[0]]=kv[1];});
  var freq=r.FREQ,iv=+(r.INTERVAL||1),count=r.COUNT?+r.COUNT:Infinity,until=r.UNTIL?parseDT(r.UNTIL).ms:rangeEnd;
  var byday=r.BYDAY?r.BYDAY.split(",").map(function(d){return DAYS.indexOf(d.slice(-2));}):null;
  var out=[],n=0,d=new Date(ev.start),guard=0,limit=Math.min(until,rangeEnd);
  while(d.getTime()<=limit&&n<count&&guard++<20000){
    if(freq=="WEEKLY"&&byday){
      var wk=new Date(d);wk.setUTCDate(wk.getUTCDate()-wk.getUTCDay());
      for(var i=0;i<7;i++){var c=new Date(wk);c.setUTCDate(c.getUTCDate()+i);
        if(byday.indexOf(i)<0||c.getTime()<ev.start||c.getTime()>limit||n>=count)continue;out.push(c.getTime());n++;}
      d=wk;d.setUTCDate(d.getUTCDate()+7*iv);continue;}
    out.push(d.getTime());n++;
    if(freq=="DAILY")d.setUTCDate(d.getUTCDate()+iv);else if(freq=="WEEKLY")d.setUTCDate(d.getUTCDate()+7*iv);
    else if(freq=="MONTHLY")d.setUTCMonth(d.getUTCMonth()+iv);else if(freq=="YEARLY")d.setUTCFullYear(d.getUTCFullYear()+iv);else break;}
  return out.filter(function(t){return ev.exdates.indexOf(t)<0;});
}
function parseICS(text,rangeEnd){
  var lines=unfold(text).split("\n"),evs=[],cur=null;
  lines.forEach(function(l){
    if(l=="BEGIN:VEVENT"){cur={exdates:[]};return;}
    if(l=="END:VEVENT"){if(cur&&cur.start!=null)evs.push(cur);cur=null;return;}
    if(!cur)return;var i=l.indexOf(":");if(i<0)return;
    var head=l.slice(0,i),val=l.slice(i+1),name=head.split(";")[0],params=head.slice(name.length);
    if(name=="SUMMARY")cur.title=val.replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\n/gi," ").trim();
    else if(name=="DTSTART"){var s=parseDT(val,params);if(s){cur.start=s.ms;cur.allDay=s.allDay;}}
    else if(name=="DTEND"){var e=parseDT(val,params);if(e)cur.end=e.ms;}
    else if(name=="DURATION")cur.dur=parseDur(val);
    else if(name=="RRULE")cur.rrule=val;
    else if(name=="RECURRENCE-ID")cur.recur=true;
    else if(name=="STATUS")cur.status=val;
    else if(name=="EXDATE")val.split(",").forEach(function(x){var p=parseDT(x,params);if(p)cur.exdates.push(p.ms);});
  });
  var occ=[];
  evs.forEach(function(ev){if(ev.status=="CANCELLED")return;
    var len=ev.end!=null?ev.end-ev.start:(ev.dur||(ev.allDay?864e5:0));
    expand(ev,rangeEnd).forEach(function(t){occ.push({title:ev.title||"(no title)",start:t,ms:len,allDay:ev.allDay});});});
  return occ;
}
function summarize(occ,o){
  var g={};occ.forEach(function(x){
    if(o.from!=null&&x.start<o.from)return;if(o.to!=null&&x.start>=o.to)return;
    if(x.allDay&&!o.includeAllDay)return;
    if(o.filter&&x.title.toLowerCase().indexOf(o.filter.toLowerCase())<0)return;
    var k=x.title;if(o.mode=="prefix"){var j=k.search(/[:\-–|]/);if(j>0)k=k.slice(0,j).trim();}
    if(o.ignoreCase)k=k.toLowerCase();
    g[k]=g[k]||{key:k,count:0,ms:0};g[k].count++;g[k].ms+=x.ms;});
  return Object.keys(g).map(function(k){return g[k];}).sort(function(a,b){return b.ms-a.ms;});
}
globalThis.CalHours={parseICS:parseICS,summarize:summarize};
if(typeof document=="undefined")return;
var $=function(id){return document.getElementById(id);},occ=[],rows=[];
function day(v){return v?Date.parse(v+"T00:00:00Z"):null;}
function render(){
  var to=day($("to").value);rows=summarize(occ,{from:day($("from").value),to:to!=null?to+864e5:null,mode:$("mode").value,
    ignoreCase:$("ic").checked,includeAllDay:$("allday").checked,filter:$("filter").value});
  var rate=parseFloat($("rate").value)||0,tot=0,html="";
  rows.forEach(function(r){var h=r.ms/36e5;tot+=h;html+="<tr><td>"+esc(r.key)+"</td><td>"+r.count+"</td><td>"+h.toFixed(2)+"</td>"+(rate?"<td>"+(h*rate).toFixed(2)+"</td>":"")+"</tr>";});
  $("thead").innerHTML="<tr><th>Event</th><th>Count</th><th>Hours</th>"+(rate?"<th>Amount</th>":"")+"</tr>";
  $("tbody").innerHTML=html;$("total").textContent="Total: "+tot.toFixed(2)+" h"+(rate?" · "+(tot*rate).toFixed(2):"")+" across "+rows.length+" groups";
  $("results").hidden=false;
}
function esc(s){return s.replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function load(text){occ=parseICS(text,Date.UTC(2100,0,1));countRun();render();}
function countRun(){/* PLACEHOLDER: run counter (e.g. GoatCounter event) - not wired until Amin approves */
  try{localStorage.setItem("ch_runs",(+localStorage.getItem("ch_runs")||0)+1);}catch(e){}
  if(window.goatcounter&&window.goatcounter.count)window.goatcounter.count({path:"run",event:true});}
$("file").addEventListener("change",function(e){var f=e.target.files[0];if(!f)return;var r=new FileReader();r.onload=function(){load(r.result);};r.readAsText(f);});
$("sample").addEventListener("click",function(){fetch("sample.ics").then(function(r){return r.text();}).then(load);});
["from","to","mode","ic","allday","filter","rate"].forEach(function(id){$(id).addEventListener("input",function(){if(occ.length)render();});});
$("csv").addEventListener("click",function(){var c="Event,Count,Hours\n"+rows.map(function(r){return '"'+r.key.replace(/"/g,'""')+'",'+r.count+","+(r.ms/36e5).toFixed(2);}).join("\n");
  var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([c],{type:"text/csv"}));a.download="calendar-hours.csv";a.click();});
})();
