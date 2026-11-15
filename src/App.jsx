import React, { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  Home, LayoutDashboard, Building2, ReceiptText, Users, KeyRound, FileText,
  Settings, LogOut, Plus, Search, Menu, X, ChevronRight, AlertCircle,
  CheckCircle2, Loader2, Pencil, Trash2, ExternalLink, Wallet, RefreshCw
} from 'lucide-react';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        fetch: (...args) => window.fetch(...args),
      },
    })
  : null;
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateLabel = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR') : '—';

const navItems = [
  { id: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'properties', label: 'Imóveis', icon: Building2 },
  { id: 'expenses', label: 'Despesas por imóvel', icon: ReceiptText },
  { id: 'catalog', label: 'Tipos de despesas', icon: Wallet },
  { id: 'providers', label: 'Fornecedores', icon: Home },
  { id: 'accounts', label: 'Contas de acesso', icon: KeyRound },
  { id: 'invoices', label: 'Faturas', icon: FileText },
];

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  
  
  
 const submit = async (e) => {
  e.preventDefault();
  setBusy(true);
  setError('');

  try {
    let result;

    if (mode === 'signin') {
      result = await supabase.auth.signInWithPassword.call(supabase.auth, {
        email,
        password
      });
    } else {
      result = await supabase.auth.signUp.call(supabase.auth, {
        email,
        password
      });
    }

    const { data, error: err } = result;

    if (err) {
      setError(err.message);
      return;
    }

    if (data.session) {
      onAuth(data.session.user);
    } else {
      setError('Cadastro iniciado. Verifique seu e-mail para confirmar a conta e depois entre.');
    }
  } catch (err) {
    console.error('Erro de autenticação:', err);
    setError(err?.message || 'Erro ao conectar com o Supabase.');
  } finally {
    setBusy(false);
  }
}; 
 
  
  return <div className="auth-wrap"><div className="auth-card">
    <div className="brand-mark"><Building2 size={23}/></div><div className="eyebrow">GESTÃO IMOBILIÁRIA</div>
    <h1>ImobControl</h1><p className="muted">Suas despesas, imóveis e faturas em um só lugar.</p>
    <div className="auth-tabs"><button className={mode==='signin'?'active':''} onClick={()=>setMode('signin')}>Entrar</button><button className={mode==='signup'?'active':''} onClick={()=>setMode('signup')}>Criar conta</button></div>
    <form onSubmit={submit} className="form-stack"><label>E-mail<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="voce@email.com"/></label><label>Senha<input type="password" minLength={6} required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres"/></label>
      {error && <div className="alert"><AlertCircle size={16}/>{error}</div>}<button className="primary-btn" disabled={busy}>{busy?<Loader2 className="spin" size={17}/>:null}{mode==='signin'?'Entrar':'Criar minha conta'}</button>
    </form><p className="tiny muted">Acesso protegido pela autenticação do Supabase.</p>
  </div></div>;
}

function App() {
  const [session, setSession] = useState(null);
  const [configured, setConfigured] = useState(Boolean(supabase));
  const [page, setPage] = useState('dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [data, setData] = useState({ properties: [], expense_types: [], providers: [], access_accounts: [], property_expenses: [], invoices: [] });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3200); };
  const refresh = async () => {
    if (!session?.user) return;
    setLoading(true);
    const tables = ['properties','expense_types','providers','access_accounts','property_expenses','invoices'];
    const results = await Promise.all(tables.map((table) => supabase.from(table).select('*').order('created_at', { ascending: false })));
    const next = {};
    results.forEach((r, i) => { next[tables[i]] = r.data || []; if (r.error) console.error(`Erro ao consultar ${tables[i]}`, r.error); });
    setData(next); setLoading(false);
  };
  useEffect(() => { refresh(); }, [session?.user?.id]);

  const signOut = async () => { await supabase.auth.signOut(); setData({ properties: [], expense_types: [], providers: [], access_accounts: [], property_expenses: [], invoices: [] }); };
  const pageTitle = navItems.find(x => x.id === page)?.label || 'Visão geral';

  if (!configured) return <div className="setup-screen"><div className="setup-card"><div className="brand-mark"><Building2/></div><h1>Vamos conectar seu Supabase</h1><p>O painel está preparado. Falta informar a URL do projeto e a chave pública (anon/publishable) no arquivo <code>.env</code>.</p><ol><li>Copie <code>.env.example</code> para <code>.env</code>.</li><li>Preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>.</li><li>Reinicie o servidor com <code>npm run dev</code>.</li></ol><p className="muted tiny">Nunca use a chave service_role no navegador.</p></div></div>;
  if (!session) return <AuthScreen onAuth={(user)=>setSession({user})}/>;

  const openCreate = (kind, item=null) => setModal({ kind, item });
  const saveRecord = async (table, payload, id) => {
    const query = id ? supabase.from(table).update(payload).eq('id', id) : supabase.from(table).insert({ ...payload, owner_id: session.user.id });
    const { error } = await query;
    if (error) { notify(error.message); return false; }
    setModal(null); await refresh(); notify(id ? 'Registro atualizado.' : 'Registro cadastrado.'); return true;
  };
  const deleteRecord = async (table, id) => {
    if (!window.confirm('Tem certeza que deseja excluir este registro?')) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) notify(error.message); else { await refresh(); notify('Registro excluído.'); }
  };

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?'show':''}`}>
      <div className="sidebar-brand"><div className="brand-mark small"><Building2 size={19}/></div><div><strong>ImobControl</strong><span>GESTÃO IMOBILIÁRIA</span></div><button className="mobile-close" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
      <div className="nav-caption">MENU PRINCIPAL</div><nav>{navItems.map(item=>{const Icon=item.icon;return <button key={item.id} className={`nav-item ${page===item.id?'selected':''}`} onClick={()=>{setPage(item.id);setMobileNav(false);setSearch('')}}><Icon size={18}/><span>{item.label}</span>{page===item.id&&<ChevronRight size={15} className="nav-chevron"/>}</button>})}</nav>
      <div className="sidebar-bottom"><div className="user-mini"><div className="avatar">{session.user.email?.[0]?.toUpperCase()}</div><div className="user-info"><strong>Administrador</strong><span>{session.user.email}</span></div></div><button className="logout-btn" onClick={signOut}><LogOut size={17}/> Sair</button></div>
    </aside>
    {mobileNav&&<div className="scrim" onClick={()=>setMobileNav(false)}/>}
    <main className="main-area">
      <header className="topbar"><button className="menu-toggle" onClick={()=>setMobileNav(true)}><Menu/></button><div className="breadcrumb">ImobControl <ChevronRight size={14}/><strong>{pageTitle}</strong></div><div className="top-actions"><button className="icon-btn" onClick={refresh} title="Atualizar"><RefreshCw size={17}/></button><div className="top-avatar">{session.user.email?.[0]?.toUpperCase()}</div></div></header>
      <div className="content-wrap">
        {page==='dashboard'&&<Dashboard data={data} loading={loading} setPage={setPage}/>}
        {page==='properties'&&<Properties data={data} search={search} setSearch={setSearch} create={()=>openCreate('property')} edit={x=>openCreate('property',x)} remove={x=>deleteRecord('properties',x.id)}/>}
        {page==='catalog'&&<Catalog data={data} search={search} setSearch={setSearch} create={()=>openCreate('expense_type')} edit={x=>openCreate('expense_type',x)} remove={x=>deleteRecord('expense_types',x.id)}/>}
        {page==='providers'&&<Providers data={data} search={search} setSearch={setSearch} create={()=>openCreate('provider')} edit={x=>openCreate('provider',x)} remove={x=>deleteRecord('providers',x.id)}/>}
        {page==='accounts'&&<Accounts data={data} search={search} setSearch={setSearch} create={()=>openCreate('account')} edit={x=>openCreate('account',x)} remove={x=>deleteRecord('access_accounts',x.id)}/>}
        {page==='expenses'&&<PropertyExpenses data={data} search={search} setSearch={setSearch} create={()=>openCreate('property_expense')} edit={x=>openCreate('property_expense',x)} remove={x=>deleteRecord('property_expenses',x.id)}/>}
        {page==='invoices'&&<Invoices data={data} search={search} setSearch={setSearch}/>}
      </div>
    </main>
    {modal&&<RecordModal modal={modal} data={data} onClose={()=>setModal(null)} onSave={saveRecord}/>}
    {toast&&<div className="toast"><CheckCircle2 size={17}/>{toast}</div>}
  </div>;
}

function PageHeading({title,subtitle,action,actionLabel='Novo cadastro'}) { return <div className="page-heading"><div><div className="eyebrow">IMOBCONTROL</div><h1>{title}</h1><p>{subtitle}</p></div>{action&&<button className="primary-btn heading-action" onClick={action}><Plus size={17}/>{actionLabel}</button>}</div>; }
function StatCard({label,value,caption,icon:Icon,tone='blue'}) { return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={20}/></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-caption">{caption}</div></div>; }
function Dashboard({data,loading,setPage}) {
  const activeProperties=data.properties.filter(x=>x.active).length;
  const activeExpenses=data.property_expenses.filter(x=>x.active).length;
  const pending=data.invoices.filter(x=>['found','downloaded','parsed','needs_review','error'].includes(x.status)).length;
  const recent=[...data.invoices].slice(0,5);
  return <><PageHeading title="Visão geral" subtitle="Acompanhe seus imóveis e despesas em um só lugar." action={()=>setPage('properties')} actionLabel="Adicionar imóvel"/>
    <div className="stats-grid"><StatCard label="Imóveis ativos" value={activeProperties} caption={`${data.properties.length} cadastrados`} icon={Building2}/><StatCard label="Despesas configuradas" value={activeExpenses} caption="Vinculadas aos imóveis" icon={ReceiptText} tone="violet"/><StatCard label="Fornecedores" value={data.providers.length} caption="Portais cadastrados" icon={Home} tone="amber"/><StatCard label="Faturas para conferir" value={pending} caption="Aguardando revisão ou ação" icon={FileText} tone="rose"/></div>
    <div className="dashboard-grid"><section className="panel"><div className="panel-head"><div><h2>Seus imóveis</h2><p>Visão rápida dos cadastros</p></div><button className="text-btn" onClick={()=>setPage('properties')}>Ver todos <ChevronRight size={15}/></button></div>
      {loading?<Loading/>:data.properties.length?<div className="property-list">{data.properties.slice(0,5).map(p=><div className="property-row" key={p.id}><div className="property-symbol"><Building2 size={19}/></div><div className="property-main"><strong>{p.nickname||p.code}</strong><span>{p.address||'Endereço não informado'}</span></div><span className={`status-pill ${p.active?'green':'gray'}`}>{p.active?'Ativo':'Inativo'}</span></div>)}</div>:<Empty icon={Building2} title="Nenhum imóvel cadastrado" text="Comece adicionando seu primeiro imóvel." action={()=>setPage('properties')} actionLabel="Cadastrar imóvel"/>}
    </section><section className="panel"><div className="panel-head"><div><h2>Atalhos</h2><p>Acesse as configurações principais</p></div></div><div className="shortcut-list">{[{label:'Cadastrar despesa em um imóvel',sub:'Vincule uma conta a um apartamento',icon:ReceiptText,to:'expenses'},{label:'Adicionar fornecedor',sub:'Cadastre Light, Naturgy e outros',icon:Home,to:'providers'},{label:'Configurar conta de acesso',sub:'Organize os diferentes logins',icon:KeyRound,to:'accounts'}].map(x=><button className="shortcut" key={x.to} onClick={()=>setPage(x.to)}><span className="shortcut-icon"><x.icon size={18}/></span><span><strong>{x.label}</strong><small>{x.sub}</small></span><ChevronRight size={17}/></button>)}</div></section></div>
    <section className="panel recent-panel"><div className="panel-head"><div><h2>Faturas recentes</h2><p>Últimos documentos registrados</p></div><button className="text-btn" onClick={()=>setPage('invoices')}>Ver faturas <ChevronRight size={15}/></button></div>{recent.length?<InvoiceTable invoices={recent} data={data}/>:<div className="empty-inline"><FileText size={19}/><span>As faturas aparecerão aqui quando forem cadastradas ou coletadas.</span></div>}</section>
  </>;
}
function Toolbar({search,setSearch,placeholder='Buscar...'}) { return <div className="toolbar"><div className="searchbox"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={placeholder}/></div></div>; }
function Empty({icon:Icon,title,text,action,actionLabel}) { return <div className="empty-state"><div className="empty-icon"><Icon size={24}/></div><strong>{title}</strong><p>{text}</p>{action&&<button className="secondary-btn" onClick={action}>{actionLabel}</button>}</div>; }
function Loading(){return <div className="loading"><Loader2 className="spin"/> Carregando...</div>}
function TableShell({headers,children}) {return <div className="table-scroll"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
function Actions({onEdit,onDelete}) {return <div className="row-actions"><button title="Editar" onClick={onEdit}><Pencil size={15}/></button><button title="Excluir" onClick={onDelete}><Trash2 size={15}/></button></div>}
function Properties({data,search,setSearch,create,edit,remove}) {
  const rows=data.properties.filter(x=>`${x.code} ${x.nickname||''} ${x.address||''}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageHeading title="Imóveis" subtitle="Cadastre e organize todos os seus imóveis." action={create} actionLabel="Adicionar imóvel"/><div className="panel list-panel"><Toolbar search={search} setSearch={setSearch} placeholder="Buscar por código, nome ou endereço"/>{rows.length?<TableShell headers={['Imóvel','Endereço','Despesas','Situação','']} >{rows.map(x=><tr key={x.id}><td><strong>{x.nickname||x.code}</strong><small className="cell-sub">Código: {x.code}</small></td><td>{x.address||'—'}</td><td>{data.property_expenses.filter(e=>e.property_id===x.id&&e.active).length}</td><td><span className={`status-pill ${x.active?'green':'gray'}`}>{x.active?'Ativo':'Inativo'}</span></td><td><Actions onEdit={()=>edit(x)} onDelete={()=>remove(x)}/></td></tr>)}</TableShell>:<Empty icon={Building2} title="Nenhum imóvel encontrado" text="Cadastre um imóvel para começar a organizar as despesas." action={create} actionLabel="Adicionar imóvel"/>}</div></>;
}
function Catalog({data,search,setSearch,create,edit,remove}) {const rows=data.expense_types.filter(x=>`${x.name} ${x.description||''}`.toLowerCase().includes(search.toLowerCase()));return <><PageHeading title="Tipos de despesas" subtitle="Mantenha um catálogo reutilizável de categorias de cobrança." action={create} actionLabel="Novo tipo"/><div className="panel list-panel"><Toolbar search={search} setSearch={setSearch} placeholder="Buscar tipo de despesa"/>{rows.length?<TableShell headers={['Tipo de despesa','Descrição','Situação','']}>{rows.map(x=><tr key={x.id}><td><strong>{x.name}</strong></td><td>{x.description||'—'}</td><td><span className={`status-pill ${x.active?'green':'gray'}`}>{x.active?'Ativo':'Inativo'}</span></td><td><Actions onEdit={()=>edit(x)} onDelete={()=>remove(x)}/></td></tr>)}</TableShell>:<Empty icon={Wallet} title="Catálogo vazio" text="Cadastre categorias como condomínio, energia, gás e IPTU." action={create} actionLabel="Cadastrar tipo"/>}</div></>}
function Providers({data,search,setSearch,create,edit,remove}) {const rows=data.providers.filter(x=>`${x.name} ${x.portal_url||''}`.toLowerCase().includes(search.toLowerCase()));return <><PageHeading title="Fornecedores" subtitle="Cadastre os portais onde as faturas são disponibilizadas." action={create} actionLabel="Novo fornecedor"/><div className="panel list-panel"><Toolbar search={search} setSearch={setSearch} placeholder="Buscar fornecedor"/>{rows.length?<TableShell headers={['Fornecedor','Portal','Tipo','Situação','']}>{rows.map(x=><tr key={x.id}><td><strong>{x.name}</strong></td><td>{x.portal_url?<a className="url-link" href={x.portal_url} target="_blank" rel="noreferrer">Acessar portal <ExternalLink size={12}/></a>:'—'}</td><td>{x.portal_type}</td><td><span className={`status-pill ${x.active?'green':'gray'}`}>{x.active?'Ativo':'Inativo'}</span></td><td><Actions onEdit={()=>edit(x)} onDelete={()=>remove(x)}/></td></tr>)}</TableShell>:<Empty icon={Home} title="Nenhum fornecedor cadastrado" text="Adicione Light, Naturgy, administradoras e outros fornecedores." action={create} actionLabel="Adicionar fornecedor"/>}</div></>}
function Accounts({data,search,setSearch,create,edit,remove}) {const rows=data.access_accounts.filter(x=>`${x.label} ${x.username||''} ${data.providers.find(p=>p.id===x.provider_id)?.name||''}`.toLowerCase().includes(search.toLowerCase()));return <><PageHeading title="Contas de acesso" subtitle="Organize os diferentes logins usados nos portais dos fornecedores." action={create} actionLabel="Nova conta de acesso"/><div className="notice"><AlertCircle size={17}/><span>Por segurança, esta tela não armazena senhas. A integração com um cofre de segredos será configurada em uma etapa própria.</span></div><div className="panel list-panel"><Toolbar search={search} setSearch={setSearch} placeholder="Buscar conta ou fornecedor"/>{rows.length?<TableShell headers={['Identificação','Fornecedor','Usuário','Verificações','']}>{rows.map(x=><tr key={x.id}><td><strong>{x.label}</strong></td><td>{data.providers.find(p=>p.id===x.provider_id)?.name||'—'}</td><td>{x.username||'—'}</td><td><div className="tag-list">{x.requires_mfa&&<span className="mini-tag">MFA</span>}{x.requires_captcha&&<span className="mini-tag">CAPTCHA</span>}{!x.requires_mfa&&!x.requires_captcha&&'—'}</div></td><td><Actions onEdit={()=>edit(x)} onDelete={()=>remove(x)}/></td></tr>)}</TableShell>:<Empty icon={KeyRound} title="Nenhuma conta cadastrada" text="Cadastre uma identificação para cada login de portal." action={create} actionLabel="Adicionar conta"/>}</div></>}
function PropertyExpenses({data,search,setSearch,create,edit,remove}) {const rows=data.property_expenses.filter(x=>{const p=data.properties.find(y=>y.id===x.property_id);const t=data.expense_types.find(y=>y.id===x.expense_type_id);const v=data.providers.find(y=>y.id===x.provider_id);return `${x.label} ${p?.nickname||p?.code||''} ${t?.name||''} ${v?.name||''}`.toLowerCase().includes(search.toLowerCase())});return <><PageHeading title="Despesas por imóvel" subtitle="Defina exatamente quais contas pertencem a cada imóvel." action={create} actionLabel="Vincular despesa"/><div className="panel list-panel"><Toolbar search={search} setSearch={setSearch} placeholder="Buscar imóvel, despesa ou fornecedor"/>{rows.length?<TableShell headers={['Despesa / conta','Imóvel','Fornecedor','Identificador','Frequência','']}>{rows.map(x=><tr key={x.id}><td><strong>{x.label}</strong><small className="cell-sub">{data.expense_types.find(y=>y.id===x.expense_type_id)?.name||'—'}</small></td><td>{data.properties.find(y=>y.id===x.property_id)?.nickname||data.properties.find(y=>y.id===x.property_id)?.code||'—'}</td><td>{data.providers.find(y=>y.id===x.provider_id)?.name||'—'}</td><td>{x.account_identifier||'—'}</td><td>{({monthly:'Mensal',annual:'Anual',quarterly:'Trimestral',other:'Outra'})[x.billing_frequency]}</td><td><Actions onEdit={()=>edit(x)} onDelete={()=>remove(x)}/></td></tr>)}</TableShell>:<Empty icon={ReceiptText} title="Nenhuma despesa vinculada" text="Associe categorias e fornecedores aos imóveis para definir o que deve ser acompanhado." action={create} actionLabel="Vincular primeira despesa"/>}</div></>}
function Invoices({data,search,setSearch}) {const rows=data.invoices.filter(x=>`${x.invoice_number||''} ${x.original_filename||''} ${x.status}`.toLowerCase().includes(search.toLowerCase()));return <><PageHeading title="Faturas" subtitle="Consulte os documentos, valores e vencimentos registrados."/><div className="panel list-panel"><Toolbar search={search} setSearch={setSearch} placeholder="Buscar fatura"/>{rows.length?<InvoiceTable invoices={rows} data={data}/>:<Empty icon={FileText} title="Nenhuma fatura registrada" text="Quando começarmos a coleta automática, os documentos aparecerão aqui."/>}</div></>}
function InvoiceTable({invoices,data}) {return <TableShell headers={['Documento','Imóvel / despesa','Referência','Vencimento','Valor','Status']}>{invoices.map(x=>{const expense=data.property_expenses.find(e=>e.id===x.property_expense_id);const property=data.properties.find(p=>p.id===expense?.property_id);return <tr key={x.id}><td><strong>{x.original_filename||x.invoice_number||'Fatura'}</strong></td><td>{property?.nickname||property?.code||'—'}<small className="cell-sub">{expense?.label||'—'}</small></td><td>{dateLabel(x.reference_month)}</td><td>{dateLabel(x.due_date)}</td><td>{x.amount==null?'—':money(x.amount)}</td><td><span className={`status-pill ${x.status==='approved'||x.status==='paid'?'green':x.status==='error'?'red':'amber'}`}>{({found:'Encontrada',downloaded:'Baixada',parsed:'Lida',needs_review:'Revisar',approved:'Aprovada',paid:'Paga',error:'Erro'})[x.status]||x.status}</span></td></tr>})}</TableShell>}

function RecordModal({modal,data,onClose,onSave}) {
  const {kind,item}=modal; const [form,setForm]=useState({}); const [busy,setBusy]=useState(false);
  useEffect(() => {
  if (item) {
    setForm(item);
    return;
  }

  if (kind === 'property_expense') {
    setForm({
      active: true,
      billing_frequency: 'monthly'
    });
  } else if (kind === 'provider') {
    setForm({
      active: true,
      portal_type: 'web'
    });
  } else {
    setForm({
      active: true
    });
  }
}, [item, kind]);
  const set=(key,value)=>setForm(old=>({...old,[key]:value}));
  const configs={
    property:{title:'Imóvel',table:'properties',fields:[['code','Código / identificação','text',true],['nickname','Nome amigável','text'],['address','Endereço','text'],['notes','Observações','textarea'],['active','Imóvel ativo','checkbox']]},
    expense_type:{title:'Tipo de despesa',table:'expense_types',fields:[['name','Nome da despesa','text',true],['description','Descrição','text'],['active','Ativo','checkbox']]},
    provider:{title:'Fornecedor',table:'providers',fields:[['name','Nome do fornecedor','text',true],['portal_url','URL do portal','url'],['portal_type','Tipo de portal','select',true,['web','email','manual','api']],['notes','Observações','textarea'],['active','Ativo','checkbox']]},
    account:{title:'Conta de acesso',table:'access_accounts',fields:[['provider_id','Fornecedor','select',true,data.providers.map(x=>[x.id,x.name])],['label','Identificação desta conta','text',true],['username','Usuário / e-mail','text'],['login_url','URL de login (se diferente)','url'],['secret_ref','Referência do segredo (cofre)','text'],['requires_mfa','Exige autenticação em duas etapas','checkbox'],['requires_captcha','Exige CAPTCHA','checkbox'],['notes','Observações','textarea'],['active','Ativa','checkbox']]},
    property_expense:{title:'Despesa do imóvel',table:'property_expenses',fields:[['property_id','Imóvel','select',true,data.properties.map(x=>[x.id,x.nickname||x.code])],['expense_type_id','Tipo de despesa','select',true,data.expense_types.map(x=>[x.id,x.name])],['provider_id','Fornecedor','select',true,data.providers.map(x=>[x.id,x.name])],['access_account_id','Conta de acesso','select',false,[['','Sem conta vinculada'],...data.access_accounts.map(x=>[x.id,x.label])]],['label','Nome desta cobrança','text',true],['account_identifier','Matrícula / instalação / código','text'],['billing_frequency','Frequência','select',true,[['monthly','Mensal'],['annual','Anual'],['quarterly','Trimestral'],['other','Outra']]],['expected_due_day','Dia de vencimento esperado','number'],['expected_amount','Valor esperado (opcional)','number'],['notes','Observações','textarea'],['active','Ativa','checkbox']]}
  };
  const cfg=configs[kind];
  const submit=async(e)=>{e.preventDefault();setBusy(true);const payload={...form};delete payload.id;delete payload.owner_id;delete payload.created_at;delete payload.updated_at;if(payload.expected_due_day==='')payload.expected_due_day=null;if(payload.expected_amount==='')payload.expected_amount=null;if(kind==='property_expense'){payload.expected_due_day=payload.expected_due_day?Number(payload.expected_due_day):null;payload.expected_amount=payload.expected_amount?Number(payload.expected_amount):null;payload.access_account_id=payload.access_account_id||null;}const ok=await onSave(cfg.table,payload,item?.id);setBusy(false);};
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal-card"><div className="modal-head"><div><div className="eyebrow">CADASTRO</div><h2>{item?'Editar':'Novo'} {cfg.title.toLowerCase()}</h2></div><button className="icon-btn" onClick={onClose}><X size={19}/></button></div><form className="modal-form" onSubmit={submit}><div className="fields-grid">{cfg.fields.map(([key,label,type,required,options])=><label key={key} className={`${type==='textarea'?'span-2':''} ${type==='checkbox'?'check-label':''}`}>{type==='checkbox'?<><input type="checkbox" checked={Boolean(form[key])} onChange={e=>set(key,e.target.checked)}/>{label}</>:<>{label}{type==='select'?<select required={required} value={form[key]??''} onChange={e=>set(key,e.target.value)}><option value="">Selecione...</option>{(options||[]).map(opt=>Array.isArray(opt)?<option key={opt[0]} value={opt[0]}>{opt[1]}</option>:<option key={opt} value={opt}>{opt}</option>)}</select>:type==='textarea'?<textarea rows="3" value={form[key]||''} onChange={e=>set(key,e.target.value)}/>:<input type={type} required={required} min={type==='number'?0:undefined} value={form[key]??''} onChange={e=>set(key,e.target.value)} />}</>}</label>)}</div>{kind==='account'&&<div className="notice modal-notice"><AlertCircle size={16}/><span>Não informe a senha aqui. Este campo guarda apenas a referência que será ligada ao cofre seguro em uma etapa futura.</span></div>}{kind==='property_expense'&&(!data.properties.length||!data.expense_types.length||!data.providers.length)&&<div className="alert"><AlertCircle size={16}/>Cadastre pelo menos um imóvel, um tipo de despesa e um fornecedor antes de vincular uma despesa.</div>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={busy}>{busy?<Loader2 className="spin" size={16}/>:null}Salvar cadastro</button></div></form></div></div>;
}

export default App;
