import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronRight, CircleAlert, ClipboardList, LayoutDashboard, Mail, MessageCircle, Send, Settings, Sparkles, Users, X, Package, Plus, Trash2, Upload, Pencil, Eye, EyeOff } from 'lucide-react';
import { api, login, uploadImages } from './api';
import Marketplace from './Marketplace';

type Event = {id:string;name:string;type:string;venue:string;start_at:string;timezone:string;archived:number}; type Guest={id:string;name:string;phone:string;rsvp:string;consent:number;suppressed:number;event_id:string};


const nav: [string, typeof LayoutDashboard][] = [
  ['Overview', LayoutDashboard],
  ['Events', CalendarDays],
  ['Guests', Users],
  ['Services', Package],
  ['Campaigns', Send],
  ['AI Studio', Sparkles],
  ['Inbox', MessageCircle],
  ['Templates', Mail],
  ['Settings', Settings],
];

const humanDate=(v:string,tz?:string)=>new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:tz||'Asia/Kolkata'}).format(new Date(v));

export default function App(){
 const [me,setMe]=useState<{name:string}|null>(null),[page,setPage]=useState('Overview'),[events,setEvents]=useState<Event[]>([]),[guests,setGuests]=useState<Guest[]>([]),[messages,setMessages]=useState<any[]>([]),[mode,setMode]=useState<any>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const load=async()=>{try{const [e,g,m,mo]=await Promise.all([api<{items:Event[]}>('/api/events'),api<{items:Guest[]}>('/api/guests'),api<{items:any[]}>('/api/messages'),api('/api/mode')]);setEvents(e.items);setGuests(g.items);setMessages(m.items);setMode(mo)}catch{setMe(null)}};
 useEffect(()=>{api<{user:{name:string}}>('/api/auth/me').then(r=>{setMe(r.user);load()}).catch(()=>setMe(null))},[]);
 const toast=(text:string)=>{setNotice(text);setTimeout(()=>setNotice(''),3500)};
 if (window.location.pathname === '/marketplace') {
  return <Marketplace />;
}
 if(!me)return <Login onLogin={async(e,p)=>{setBusy(true);try{const r=await login(e,p);setMe(r.user);await load()}catch(err){toast(err instanceof Error?err.message:'Sign in failed')}finally{setBusy(false)}}} busy={busy} notice={notice}/>;
 return <div className="shell"><aside><div className="brand"><span className="brandmark">✦</span><span>EventWiz <b>AI</b></span></div><div className="workspace"><span className="avatar">AS</span><div><b>{me.name}</b><small>Organizer workspace</small></div></div><nav>{nav.map(([name,Icon])=><button key={name} className={page===name?'active':''} onClick={()=>setPage(name as string)}><Icon size={18}/>{name}</button>)}</nav><div className="safety"><CheckCircle2 size={18}/><span><b>Consent-first</b><small>Every send is checked</small></span></div></aside><main><header><div><p className="eyebrow">EVENT OPERATIONS</p><h1>{page}</h1></div><div className="header-actions"><span className={'mode '+(mode?.mode==='live'?'live':'demo')}>{mode?.mode==='live'?'LIVE MODE':'DEMO MODE'}</span><button className="primary" onClick={()=>setPage('Events')}><CalendarDays size={17}/> New event</button></div></header>{mode?.mode==='demo'&&<div className="demo-banner"><CircleAlert size={18}/><span><b>Demo mode:</b> delivery updates and AI fallback copy are simulated. No WhatsApp message will be sent.</span></div>}
 {page==='Overview'&&<Overview events={events} guests={guests} messages={messages} go={setPage}/>} {page==='Events'&&<EventsPage events={events} refresh={load} toast={toast}/>} {page==='Guests'&&<GuestsPage events={events} guests={guests} refresh={load} toast={toast}/>} {page==='Services'&&<ServicesPage toast={toast}/>} {page==='Campaigns'&&<Campaigns events={events} toast={toast}/>} {page==='AI Studio'&&<Studio events={events} toast={toast}/>} {page==='Inbox'&&<Inbox messages={messages}/>} {page==='Templates'&&<Templates toast={toast}/>} {page==='Settings'&&<SettingsPage toast={toast}/>}
 </main>{notice&&<div className="toast"><CheckCircle2 size={18}/>{notice}</div>}</div>
}
function Login({onLogin,busy,notice}:{onLogin:(e:string,p:string)=>void;busy:boolean;notice:string}){const [email,setEmail]=useState('demo@eventwiz.local'),[password,setPassword]=useState('DemoPass123!');return <div className="login"><div className="login-card"><div className="brand"><span className="brandmark">✦</span>EventWiz <b>AI</b></div><h1>Welcome back</h1><p>Sign in to coordinate memorable events.</p><label>Email<input value={email} onChange={e=>setEmail(e.target.value)} /></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} /></label>{notice&&<p className="error">{notice}</p>}<button className="primary wide" disabled={busy} onClick={()=>onLogin(email,password)}>{busy?'Signing in…':'Sign in'}</button><small>Demo account is prefilled. Demo sends are always simulated.</small></div></div>}
function Overview({events,guests,messages,go}:{events:Event[];guests:Guest[];messages:any[];go:(x:string)=>void}){const consented=guests.filter(x=>x.consent&&!x.suppressed).length;return <><section className="hero"><div><p className="eyebrow">GOOD AFTERNOON</p><h2>Make every guest feel expected.</h2><p>Organize events, keep consent in view, and send thoughtful updates with confidence.</p><button className="primary" onClick={()=>go('AI Studio')}><Sparkles size={17}/> Create a message</button></div><div className="hero-orb">✦</div></section><section className="cards"><Metric icon={<CalendarDays/>} value={events.filter(x=>!x.archived).length} label="Active events"/><Metric icon={<Users/>} value={guests.length} label="Guests"/><Metric icon={<CheckCircle2/>} value={consented} label="Eligible contacts"/><Metric icon={<MessageCircle/>} value={messages.length} label="Message records"/></section><section className="two-col"><Panel title="Upcoming events" action="Manage events" onAction={()=>go('Events')}>{events.filter(x=>!x.archived).slice(0,4).map(e=><div className="row" key={e.id}><span className="cal"><b>{new Date(e.start_at).getDate()}</b>{new Intl.DateTimeFormat('en',{month:'short'}).format(new Date(e.start_at))}</span><div><b>{e.name}</b><small>{e.type} · {e.venue||'Venue TBD'}</small></div><ChevronRight/></div>)||<Empty text="Create your first event to get started."/>}</Panel><Panel title="Consent & delivery" action="View guests" onAction={()=>go('Guests')}><div className="status-list"><p><span>Recorded consent</span><b>{consented} guests</b></p><p><span>Consent needed</span><b>{guests.filter(x=>!x.consent).length} guests</b></p><p><span>Suppressed contacts</span><b>{guests.filter(x=>x.suppressed).length} guests</b></p><p><span>Recent simulated deliveries</span><b>{messages.filter(x=>x.simulated).length}</b></p></div></Panel></section></>}
function Metric({icon,value,label}:{icon:any;value:number;label:string}){return <div className="metric"><span>{icon}</span><b>{value}</b><small>{label}</small></div>}; function Panel({title,action,onAction,children}:{title:string;action:string;onAction:()=>void;children:any}){return <section className="panel"><div className="panelhead"><h3>{title}</h3><button className="link" onClick={onAction}>{action}</button></div>{children}</section>}; function Empty({text}:{text:string}){return <div className="empty">{text}</div>}
function EventsPage({events,refresh,toast}:{events:Event[];refresh:()=>Promise<void>;toast:(x:string)=>void}){const [open,setOpen]=useState(false);const [name,setName]=useState('');const [type,setType]=useState('Wedding');const [venue,setVenue]=useState('');const [start,setStart]=useState('2026-11-20T18:00');const create=async()=>{try{await api('/api/events',{method:'POST',body:JSON.stringify({name,type,description:'',venue,map_url:'',start_at:new Date(start).toISOString(),end_at:new Date(new Date(start).getTime()+3*36e5).toISOString(),timezone:'Asia/Kolkata',registration_url:'',dress_code:'',parking:'',organizer_contact:''})});setOpen(false);await refresh();toast('Event created. Add its guests and consent records next.')}catch(e){toast(e instanceof Error?e.message:'Could not create event')}};return <><section className="page-top"><div><h2>Your events</h2><p>All event dates are stored in UTC with their selected event timezone.</p></div><button className="primary" onClick={()=>setOpen(true)}>+ New event</button></section><section className="list panel">{events.map(e=><div className="event-card" key={e.id}><span className="event-icon"><CalendarDays/></span><div><b>{e.name}</b><p>{e.type} · {humanDate(e.start_at,e.timezone)} · {e.venue||'Venue TBD'}</p></div>{e.archived?<span className="pill">Archived</span>:<button className="link" onClick={async()=>{await api(`/api/events/${e.id}/archive`,{method:'POST'});await refresh();toast('Event archived.')}}>Archive</button>}</div>)}</section>{open&&<Modal title="Create event" close={()=>setOpen(false)}><label>Event name<input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Product Summit 2026"/></label><label>Event type<select value={type} onChange={e=>setType(e.target.value)}>{['Wedding','Birthday','College','Seminar','Conference','Corporate','Other'].map(x=><option>{x}</option>)}</select></label><label>Venue<input value={venue} onChange={e=>setVenue(e.target.value)} placeholder="Venue name"/></label><label>Starts at<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><button className="primary wide" onClick={create}>Create event</button></Modal>}</>}
function GuestsPage({events,guests,refresh,toast}:{events:Event[];guests:Guest[];refresh:()=>Promise<void>;toast:(x:string)=>void}){const [open,setOpen]=useState(false);const [eventId,setEventId]=useState(events[0]?.id||'');const [name,setName]=useState('');const [phone,setPhone]=useState('');const [consent,setConsent]=useState(false);const [source,setSource]=useState('');const add=async()=>{try{await api('/api/guests',{method:'POST',body:JSON.stringify({event_id:eventId,name,phone,email:'',rsvp:'Pending',consent,consent_source:source})});setOpen(false);await refresh();toast('Guest saved. Consent status is recorded.')}catch(e){toast(e instanceof Error?e.message:'Could not save guest')}};return <><section className="page-top"><div><h2>Guest contacts</h2><p>A phone number is never treated as consent by itself.</p></div><button className="primary" onClick={()=>setOpen(true)}>+ Add guest</button></section><section className="panel table-wrap"><table><thead><tr><th>Guest</th><th>Event</th><th>RSVP</th><th>Messaging permission</th></tr></thead><tbody>{guests.map(g=><tr key={g.id}><td><b>{g.name}</b><small>{g.phone}</small></td><td>{events.find(e=>e.id===g.event_id)?.name||'—'}</td><td><span className="pill">{g.rsvp}</span></td><td>{g.suppressed?<span className="danger">Suppressed</span>:g.consent?<span className="good">Recorded consent</span>:<span className="muted">Consent needed</span>}</td></tr>)}</tbody></table>{!guests.length&&<Empty text="No guests yet."/>}</section>{open&&<Modal title="Add guest" close={()=>setOpen(false)}><label>Event<select value={eventId} onChange={e=>setEventId(e.target.value)}>{events.map(e=><option value={e.id}>{e.name}</option>)}</select></label><label>Full name<input value={name} onChange={e=>setName(e.target.value)}/></label><label>Phone number<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+919876543210"/></label><label className="check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I have recorded messaging consent</label>{consent&&<label>Consent source<input value={source} onChange={e=>setSource(e.target.value)} placeholder="e.g. RSVP form, 9 Oct 2026"/></label>}<button className="primary wide" onClick={add}>Save guest</button></Modal>}</>}
function Campaigns({events,toast}:{events:Event[];toast:(x:string)=>void}){const [items,setItems]=useState<any[]>([]);const [eventId,setEventId]=useState(events[0]?.id||'');const load=()=>api<{items:any[]}>('/api/campaigns').then(x=>setItems(x.items));useEffect(()=>{load()},[]);const create=async()=>{try{await api('/api/campaigns',{method:'POST',body:JSON.stringify({event_id:eventId,name:'Event reminder'})});await load();toast('Draft campaign created. Review it before confirming.')}catch(e){toast(e instanceof Error?e.message:'Could not create campaign')}};return <><section className="page-top"><div><h2>Campaign review</h2><p>Sending remains disabled until the recipient eligibility preview is confirmed.</p></div><div><select value={eventId} onChange={e=>setEventId(e.target.value)}>{events.map(e=><option value={e.id}>{e.name}</option>)}</select> <button className="primary" onClick={create}>Create draft</button></div></section><section className="panel list">{items.map(c=><CampaignRow key={c.id} c={c} onDone={load} toast={toast}/>)||<Empty text="No campaigns yet."/>}</section></>}
function CampaignRow({c,onDone,toast}:{c:any;onDone:()=>void;toast:(x:string)=>void}) {
  const [preview,setPreview]=useState<any>(null);
  const confirm = async () => {
    try {
      const r=await api<any>(`/api/campaigns/${c.id}/confirm`,{method:'POST'});
      toast(`${r.sent} ${r.simulated?'simulated ':''}messages processed.`);
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
  };
  return <div className="campaign"><div><b>{c.name}</b><small>{c.event_name} · {c.status}</small>{preview&&<p className="preview">Eligible: <b>{preview.eligible}</b> · Skipped: <b>{preview.skipped}</b> {preview.simulated&&'· simulated delivery'}</p>}</div><div>{c.status==='Draft'&&<><button className="secondary" onClick={async()=>setPreview(await api(`/api/campaigns/${c.id}/preview`))}>Review</button>{preview&&<button className="primary" onClick={confirm}>Confirm send</button>}</>}</div></div>
}
function Studio({events,toast}:{events:Event[];toast:(x:string)=>void}){const [eventId,setEventId]=useState(events[0]?.id||''),[recipient,setRecipient]=useState('Priya'),[purpose,setPurpose]=useState('Invitation'),[text,setText]=useState(''),[demo,setDemo]=useState(false),[loading,setLoading]=useState(false);const generate=async()=>{setLoading(true);try{const r=await api<{text:string;demo:boolean}>('/api/ai/generate',{method:'POST',body:JSON.stringify({event_id:eventId,recipient,purpose,language:'English',tone:'Festive',length:'Medium'})});setText(r.text);setDemo(r.demo)}catch(e){toast(e instanceof Error?e.message:'Could not generate copy')}finally{setLoading(false)}};return <section className="studio"><div className="panel studio-controls"><p className="eyebrow">VERIFIED-DATA-ONLY COPY</p><h2>AI message studio</h2><p>The assistant receives stored event facts only. Always preview, edit, and approve copy before campaign use.</p><label>Event<select value={eventId} onChange={e=>setEventId(e.target.value)}>{events.map(e=><option value={e.id}>{e.name}</option>)}</select></label><label>Recipient name<input value={recipient} onChange={e=>setRecipient(e.target.value)}/></label><label>Purpose<select value={purpose} onChange={e=>setPurpose(e.target.value)}>{['Invitation','Registration confirmation','Reminder','Update','Thank you','FAQ'].map(x=><option>{x}</option>)}</select></label><button className="primary wide" disabled={loading||!eventId} onClick={generate}><Sparkles size={16}/>{loading?'Generating…':'Generate message'}</button></div><div className="panel message-preview"><div className="panelhead"><h3>Preview</h3>{demo&&<span className="pill">Local demo copy</span>}</div>{text?<><textarea value={text} onChange={e=>setText(e.target.value)}/><p className="muted">Edited copy is not sent automatically. Create a reviewed campaign to continue.</p></>:<Empty text="Generate a message to see it here."/>}</div></section>}
function Inbox({messages}:{messages:any[]}){return <><section className="page-top"><div><h2>Incoming & delivery inbox</h2><p>Webhook events and delivery records are auditable. Simulated status is never presented as live delivery.</p></div></section><section className="panel list">{messages.length?messages.map(m=><div className="message" key={m.id}><span className="message-icon"><MessageCircle/></span><div><b>{m.direction==='inbound'?'Incoming message':'Outbound message'} {m.simulated?'· simulated':''}</b><p>{m.content}</p><small>{m.status} · {new Date(m.created_at).toLocaleString()}</small></div></div>):<Empty text="No messages have been received or sent yet."/>}</section></>}
function Templates({toast}:{toast:(x:string)=>void}){const [items,setItems]=useState<any[]>([]);const [name,setName]=useState('');const load=()=>api<{items:any[]}>('/api/templates').then(x=>setItems(x.items));useEffect(()=>{load()},[]);const save=async()=>{try{await api('/api/templates',{method:'POST',body:JSON.stringify({name,category:'UTILITY',body:'Hello {{1}}, event update.',approved:false})});setName('');load();toast('Template saved as unapproved. Meta approval is required in live mode.')}catch(e){toast(e instanceof Error?e.message:'Invalid template')}};return <><section className="page-top"><div><h2>Message templates</h2><p>Mark a template approved only after it has been approved by Meta.</p></div></section><section className="panel"><div className="inline-form"><input value={name} onChange={e=>setName(e.target.value)} placeholder="New template name"/><button className="primary" onClick={save}>Add template</button></div><div className="list">{items.map(t=><div className="campaign" key={t.id}><div><b>{t.name}</b><small>{t.category} · {t.body}</small></div><span className={t.approved?'good':'pill'}>{t.approved?'Approved':'Unapproved'}</span></div>)}</div></section></>}
function SettingsPage({toast}:{toast:(x:string)=>void}){const [status,setStatus]=useState<any>(null);const [phone,setPhone]=useState('');const check=async()=>{const s=await api('/api/settings/whatsapp');setStatus(s)};const optout=async()=>{try{await api('/api/suppressions',{method:'POST',body:JSON.stringify({phone,reason:'Organizer-managed opt-out'})});setPhone('');toast('Contact suppressed. Future campaigns will skip this number.')}catch(e){toast(e instanceof Error?e.message:'Could not suppress contact')}};return <div className="settings-grid"><section className="panel"><p className="eyebrow">OFFICIAL CLOUD API</p><h2>WhatsApp connection</h2><p>EventWiz only uses Meta's official WhatsApp Business Platform Cloud API.</p><button className="secondary" onClick={check}>Verify server configuration</button>{status&&<div className={status.connected?'connection yes':'connection no'}><b>{status.connected?'Connected & verified':'Not connected'}</b><p>{status.phone||status.reason}</p></div>}</section><section className="panel"><p className="eyebrow">CONSENT & OPT-OUTS</p><h2>Suppression list</h2><p>STOP and UNSUBSCRIBE must be respected. Adding a number revokes its sending permission.</p><div className="inline-form"><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+919876543210"/><button className="danger-btn" onClick={optout}>Suppress</button></div></section><section className="panel full"><p className="eyebrow">WEBHOOK GUIDE</p><h3>Configure Meta safely</h3><ol><li>Set a public HTTPS callback URL: <code>/api/webhooks/whatsapp</code>.</li><li>Use the server-side <code>WHATSAPP_VERIFY_TOKEN</code> for Meta verification.</li><li>Subscribe to the <code>messages</code> field.</li><li>Set <code>META_APP_SECRET</code>; every POST is checked using HMAC SHA-256.</li></ol></section></div>}
function Modal({title,close,children}:{title:string;close:()=>void;children:any}){return <div className="modalback"><div className="modal"><div className="panelhead"><h2>{title}</h2><button className="iconbutton" onClick={close}><X/></button></div>{children}</div></div>}

type Service = {
  id: string;
  name: string;
  category: string;
  price: number;
  pricingType: string;
  description: string;
  inclusions?: string[];
  addOns?: string[];
  availability?: string;
  location?: string;
  published?: boolean | number;
  images?: { id?: string; path?: string; url?: string }[];
};

function ServicesPage({ toast }: { toast: (x: string) => void }) {
  const [items, setItems] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('Decoration');
  const [price, setPrice] = useState('0');
  const [pricingType, setPricingType] = useState('fixed');
  const [description, setDescription] = useState('');
  const [availability, setAvailability] = useState('Available');
  const [location, setLocation] = useState('');
  const [published, setPublished] = useState(true);
  const [files, setFiles] = useState<File[]>([]);

  const load = async () => {
    setLoading(true);

    try {
      const result = await api<{ items: Service[] }>('/api/services');
      setItems(result.items || []);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Services load nahi hui');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const reset = () => {
    setEditing(null);
    setName('');
    setCategory('Decoration');
    setPrice('0');
    setPricingType('fixed');
    setDescription('');
    setAvailability('Available');
    setLocation('');
    setPublished(true);
    setFiles([]);
  };

  const edit = (s: Service) => {
    setEditing(s.id);
    setName(s.name || '');
    setCategory(s.category || 'Other');
    setPrice(String(s.price ?? 0));
    setPricingType(s.pricingType || 'fixed');
    setDescription(s.description || '');
    setAvailability(s.availability || 'Available');
    setLocation(s.location || '');
    setPublished(Boolean(s.published));
    setFiles([]);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async () => {
    if (!name.trim()) {
      toast('Service ka naam likho');
      return;
    }

    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice) || numericPrice < 0) {
      toast('Valid price enter karo');
      return;
    }

    setSaving(true);

    try {
      const payload = {
        name: name.trim(),
        category,
        price: numericPrice,
        pricingType,
        description: description.trim(),
        availability,
        location: location.trim(),
        published
      };

      const result = await api<{ item?: Service; id?: string }>(
        editing ? `/api/services/${editing}` : '/api/services',
        {
          method: editing ? 'PATCH' : 'POST',
          body: JSON.stringify(payload)
        }
      );

      const serviceId = editing || result.item?.id || result.id;

      if (files.length > 0 && serviceId) {
        await uploadImages(`/api/services/${serviceId}/images`, files);
      }

      reset();
      await load();
      toast(editing ? 'Service update ho gayi!' : 'Service add ho gayi!');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Service save nahi hui');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Kya tum is service ko delete karna chahte ho?')) {
      return;
    }

    try {
      await api(`/api/services/${id}`, { method: 'DELETE' });
      await load();
      toast('Service delete ho gayi');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete nahi hui');
    }
  };

  const togglePublish = async (s: Service) => {
    try {
      await api(`/api/services/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ published: !s.published })
      });

      await load();
      toast(s.published ? 'Service unpublished' : 'Service published');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Status update nahi hua');
    }
  };

  return (
    <>
      <section className="page-top">
        <div>
          <h2>Services Catalog</h2>
          <p>Apni event services, prices, photos aur availability manage karo.</p>
        </div>
        <span className="pill">{items.length} services</span>
      </section>

      <section className="panel" style={{ marginBottom: 22 }}>
        <div className="panelhead">
          <h3>{editing ? 'Edit service' : 'Add a service'}</h3>
          {editing && (
            <button className="secondary" onClick={reset}>
              Cancel edit
            </button>
          )}
        </div>

        <div className="service-form-grid">
          <label>
            Service name
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Wedding Decoration"
            />
          </label>

          <label>
            Category
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {[
                'Decoration',
                'Catering',
                'Photography',
                'Venue',
                'Music',
                'Lighting',
                'Planning',
                'Other'
              ].map(x => <option key={x}>{x}</option>)}
            </select>
          </label>

          <label>
            Price (₹)
            <input
              type="number"
              min="0"
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
          </label>

          <label>
            Pricing type
            <select
              value={pricingType}
              onChange={e => setPricingType(e.target.value)}
            >
              <option value="fixed">Fixed price</option>
              <option value="starting">Starting from</option>
              <option value="quote">Request a quote</option>
            </select>
          </label>

          <label>
            Availability
            <select
              value={availability}
              onChange={e => setAvailability(e.target.value)}
            >
              <option>Available</option>
              <option>Limited availability</option>
              <option>Unavailable</option>
            </select>
          </label>

          <label>
            Location
            <input
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="City or service area"
            />
          </label>
        </div>

        <label>
          Description
          <textarea
            style={{ minHeight: 100 }}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Service mein kya included hai?"
          />
        </label>

        <label>
          Service images (maximum 8)
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={e =>
              setFiles(Array.from(e.target.files || []).slice(0, 8))
            }
          />
          <small>{files.length} new image(s) selected</small>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={published}
            onChange={e => setPublished(e.target.checked)}
          />
          Publish this service
        </label>

        <button className="primary" disabled={saving} onClick={save}>
          <Plus size={16} />
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Add service'}
        </button>
      </section>

      <section className="panel">
        <div className="panelhead">
          <h3>Your services</h3>
          <button className="secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        {loading ? (
          <Empty text="Loading services…" />
        ) : items.length === 0 ? (
          <Empty text="Abhi koi service nahi hai. Upar se apni first service add karo." />
        ) : (
          <div className="service-grid">
            {items.map(s => (
              <article className="service-card" key={s.id}>
                {s.images?.[0]?.path || s.images?.[0]?.url ? (
                  <img
                    className="service-image"
                    src={s.images[0].path || s.images[0].url}
                    alt={s.name}
                  />
                ) : (
                  <div className="service-image service-placeholder">
                    <Package size={34} />
                  </div>
                )}

                <div className="service-card-body">
                  <div className="service-card-top">
                    <span className="pill">{s.category}</span>
                    <span className={s.published ? 'good' : 'muted'}>
                      {s.published ? 'Published' : 'Unpublished'}
                    </span>
                  </div>

                  <h3>{s.name}</h3>
                  <p>{s.description || 'No description added.'}</p>

                  <strong className="service-price">
                    {s.pricingType === 'quote'
                      ? 'Request a quote'
                      : `${s.pricingType === 'starting' ? 'From ' : ''}₹${Number(s.price || 0).toLocaleString('en-IN')}`}
                  </strong>

                  <small>
                    {s.availability || 'Availability not set'}
                    {s.location ? ` · ${s.location}` : ''}
                  </small>

                  <div className="service-actions">
                    <button className="secondary" onClick={() => edit(s)}>
                      <Pencil size={14} /> Edit
                    </button>

                    <button
                      className="secondary"
                      onClick={() => void togglePublish(s)}
                    >
                      {s.published ? <EyeOff size={14} /> : <Eye size={14} />}
                      {s.published ? 'Unpublish' : 'Publish'}
                    </button>

                    <button
                      className="danger-btn"
                      onClick={() => void remove(s.id)}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
