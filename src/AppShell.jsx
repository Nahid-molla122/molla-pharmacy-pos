import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, LogOut, Pencil, ShieldCheck, TriangleAlert, Users, X } from 'lucide-react';
import { POSApp, PublicReceiptPage } from './App.jsx';

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (response.status === 204) return null;
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Pharmacy API is unavailable. Start it with `npm run server` and check your MongoDB configuration.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function PasswordField({ label, value, onChange, autoComplete, required = false, minLength, placeholder }) {
  const [visible, setVisible] = useState(false);
  return <label>{label}<span className="relative mt-1 block">
    <input required={required} minLength={minLength} type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value}
      placeholder={placeholder} onChange={onChange} className="pr-12"/>
    <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500"
      aria-label={visible ? 'Hide password' : 'Show password'} onClick={()=>setVisible(current=>!current)}>
      {visible ? <EyeOff size={18}/> : <Eye size={18}/>}
    </button>
  </span></label>;
}

function Login({ onLogin, error, busy }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const submit = async event => {
    event.preventDefault();
    setMessage('');
    try {
      await onLogin(email, password);
    } catch (loginError) {
      setMessage(loginError.message);
    }
  };

  return <main className="flex min-h-screen items-center justify-center p-4">
    <form onSubmit={submit} className="card w-full max-w-sm space-y-4">
      <div className="text-center">
        <ShieldCheck className="mx-auto mb-2 text-brand-700" size={36}/>
        <h1 className="text-2xl font-extrabold">Pharmacy Quick POS</h1>
        <p className="muted mt-1">Sign in to continue</p>
      </div>
      {(message || error) && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{message || error}</p>}
      <label>Email / account identifier<input autoComplete="username" type="text" maxLength={254} required value={email} onChange={event=>setEmail(event.target.value)}/></label>
      <PasswordField label="Password" autoComplete="current-password" required value={password} onChange={event=>setPassword(event.target.value)}/>
      <button className="btn w-full" type="submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
      <p className="muted text-center">Ask your administrator to create or activate your account.</p>
    </form>
  </main>;
}

function AccountManagement({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('user');
  const [editingUser, setEditingUser] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request('/api/users');
      setUsers(result.users);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh() }, [refresh]);

  const createUser = async event => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await request('/api/users', { method: 'POST', body: JSON.stringify({ name, email, password, role }) });
      setName('');
      setEmail('');
      setPassword('');
      setRole('user');
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const updateUser = async (user, update) => {
    setError('');
    try {
      const result = await request(`/api/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: JSON.stringify(update) });
      setUsers(current => current.map(item => item.id === user.id ? result.user : item));
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  const editUser = user => setEditingUser({ id: user.id, name: user.name, email: user.email, role: user.role, password: '' });

  const saveUser = async event => {
    event.preventDefault();
    setEditSaving(true);
    setError('');
    const { id, ...update } = editingUser;
    if (!update.password) delete update.password;
    try {
      const result = await request(`/api/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(update) });
      setUsers(current => current.map(user => user.id === id ? result.user : user));
      setEditingUser(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setEditSaving(false);
    }
  };

  const deleteUser = async () => {
    if (!deleteConfirmation || deleteSaving) return;
    setError('');
    setDeleteSaving(true);
    try {
      await request(`/api/users/${encodeURIComponent(deleteConfirmation.id)}`, { method: 'DELETE' });
      setUsers(current => current.filter(item => item.id !== deleteConfirmation.id));
      setDeleteConfirmation(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setDeleteSaving(false);
    }
  };

  return <section className="mx-auto max-w-2xl space-y-4 px-3 py-4 sm:px-5">
    <div className="card">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><h2 className="text-lg font-extrabold">Create account</h2><p className="muted">New accounts are active immediately.</p></div>
        <button type="button" className="btn2 !min-h-10 !py-2" onClick={onClose}><X size={17} className="inline"/> Close</button>
      </div>
      {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={createUser}>
        <label>Name<input required maxLength={100} value={name} onChange={event=>setName(event.target.value)}/></label>
        <label>Email / account identifier<input required type="text" maxLength={254} autoComplete="off" value={email} onChange={event=>setEmail(event.target.value)}/></label>
        <PasswordField label="Password (at least 4 characters)" required minLength={4} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/>
        <label>Role<select value={role} onChange={event=>setRole(event.target.value)}><option value="user">User</option><option value="admin">Admin</option></select></label>
        <button className="btn sm:col-span-2" disabled={saving}>{saving?'Creating…':'Create account'}</button>
      </form>
    </div>
    <div className="card">
      <div className="mb-3 flex items-center gap-2"><Users size={20} className="text-brand-700"/><h2 className="font-bold">Accounts</h2></div>
      {editingUser && <form className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2" onSubmit={saveUser}>
        <h3 className="font-bold sm:col-span-2">Edit account</h3>
        <label>Name<input required maxLength={100} value={editingUser.name} onChange={event=>setEditingUser(current=>({...current,name:event.target.value}))}/></label>
        <label>Email / account identifier<input required type="text" maxLength={254} autoComplete="off" value={editingUser.email} onChange={event=>setEditingUser(current=>({...current,email:event.target.value}))}/></label>
        <PasswordField label="New password (at least 4 characters, optional)" minLength={4} autoComplete="new-password" value={editingUser.password} placeholder="Leave blank to keep current password"
          onChange={event=>setEditingUser(current=>({...current,password:event.target.value}))}/>
        <label>Role<select value={editingUser.role} onChange={event=>setEditingUser(current=>({...current,role:event.target.value}))}><option value="user">User</option><option value="admin">Admin</option></select></label>
        <div className="flex gap-2 sm:col-span-2">
          <button className="btn flex-1" disabled={editSaving}>{editSaving?'Saving…':'Save changes'}</button>
          <button type="button" className="btn2" disabled={editSaving} onClick={()=>setEditingUser(null)}>Cancel</button>
        </div>
      </form>}
      {loading ? <p className="muted">Loading accounts…</p> : users.length ? <div className="divide-y">
        {users.map(user=><div key={user.id} className="flex flex-wrap items-center gap-2 py-3">
          <div className="min-w-0 flex-1"><b className="block truncate">{user.name}{user.isPrimaryAdmin&&<span className="chip ml-2">Main administrator</span>}</b><span className="muted">{user.email} · {user.active?'Active':'Inactive'}</span></div>
          <button type="button" className="btn2 !min-h-10 !py-2" onClick={()=>editUser(user)}><Pencil size={15} className="mr-1 inline"/>Edit</button>
          <select aria-label={`Role for ${user.email}`} className="!w-auto !py-2" value={user.role} onChange={event=>updateUser(user,{role:event.target.value})}><option value="user">User</option><option value="admin">Admin</option></select>
          <button type="button" className="btn2 !min-h-10 !py-2" onClick={()=>updateUser(user,{active:!user.active})}>{user.active?'Deactivate':'Activate'}</button>
          {!user.isPrimaryAdmin&&<button type="button" className="rounded-lg px-2 py-2 font-semibold text-red-600" onClick={()=>setDeleteConfirmation(user)}>Delete</button>}
        </div>)}
      </div> : <p className="muted">No accounts found.</p>}
    </div>
    {deleteConfirmation&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm" onClick={()=>!deleteSaving&&setDeleteConfirmation(null)} onKeyDown={event=>{if(event.key==='Escape'&&!deleteSaving)setDeleteConfirmation(null)}}>
      <section role="alertdialog" aria-modal="true" aria-labelledby="account-delete-title" aria-describedby="account-delete-description" className="w-full max-w-sm rounded-2xl border border-amber-200 bg-white p-5 shadow-2xl" onClick={event=>event.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><TriangleAlert size={22}/></span>
          <div><h2 id="account-delete-title" className="text-lg font-extrabold text-slate-900">Delete account?</h2><p id="account-delete-description" className="mt-2 text-sm leading-6 text-slate-600">Permanently delete the account for {deleteConfirmation.name} ({deleteConfirmation.email})?</p><p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">This cannot be undone.</p></div>
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn2 !min-h-11 !py-2" disabled={deleteSaving} onClick={()=>setDeleteConfirmation(null)}>Cancel</button><button type="button" className="min-h-11 rounded-xl bg-red-600 px-4 py-2 font-bold text-white shadow-md shadow-red-200 hover:bg-red-700 disabled:opacity-60" disabled={deleteSaving} onClick={deleteUser}>{deleteSaving?'Deleting…':'Delete account'}</button></div>
      </section>
    </div>}
  </section>;
}

export default function AppShell() {
  const [session, setSession] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accountsOpen, setAccountsOpen] = useState(false);
  const revision = useRef(0);
  const saveQueue = useRef(Promise.resolve());
  const publicReceiptToken = new URLSearchParams(window.location.search).get('receipt');

  const loadData = useCallback(async user => {
    if (!user || typeof user.id !== 'string' || typeof user.role !== 'string' || typeof user.name !== 'string') {
      throw new Error('The server returned an invalid session. Please sign in again.');
    }
    const result = await request('/api/data');
    if (!result.data || !Number.isSafeInteger(result.version)) {
      throw new Error('The server returned invalid pharmacy data. Please contact your administrator.');
    }
    revision.current = result.version;
    setSession({ user, data: result.data });
  }, []);

  useEffect(() => {
    if (publicReceiptToken) return undefined;
    let mounted = true;
    request('/api/auth/me')
      .then(async ({ user }) => {
        if (mounted) await loadData(user);
      })
      .catch(requestError => {
        if (mounted && !requestError.message.includes('Sign in')) setError(requestError.message);
      })
      .finally(() => { if (mounted) setInitializing(false) });
    return () => { mounted = false };
  }, [loadData]);

  const login = async (email, password) => {
    setBusy(true);
    setError('');
    try {
      const { user } = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      await loadData(user);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      setSession(null);
      setAccountsOpen(false);
    }
  };

  const persistData = useCallback(data => {
    const operation = saveQueue.current.catch(() => {}).then(async () => {
      try {
        const result = await request('/api/data', {
          method: 'PUT',
          body: JSON.stringify({ data, version: revision.current }),
        });
        revision.current = result.version;
        setError('');
      } catch (saveError) {
        if (saveError.message.includes('changed in another session')) {
          window.alert(`${saveError.message} Your unsaved change was not applied.`);
          window.location.reload();
        }
        throw saveError;
      }
    });
    saveQueue.current = operation.catch(() => {});
    return operation;
  }, []);

  const reportPersistenceError = useCallback(message => setError(`Could not save your changes: ${message}`), []);
  const onPersistenceError = useCallback(message => {
    reportPersistenceError(message);
    window.setTimeout(() => setError(current => current.startsWith('Could not save your changes:') ? '' : current), 5000);
  }, [reportPersistenceError]);

  if (publicReceiptToken) return <PublicReceiptPage token={publicReceiptToken}/>;
  if (initializing) return <main className="flex min-h-screen items-center justify-center p-4"><p className="muted">Connecting to the pharmacy server…</p></main>;
  if (!session?.user) return <Login onLogin={login} error={error} busy={busy}/>;

  return <div>
    <div className="mx-auto flex max-w-2xl items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2 text-sm sm:px-5">
      <span className="min-w-0 truncate">{session.user.name} <span className="chip ml-1">{session.user.role}</span></span>
      <div className="flex shrink-0 gap-2">
        {session.user.isPrimaryAdmin && <button type="button" className="btn2 !min-h-10 !py-2" onClick={()=>setAccountsOpen(open=>!open)}><Users size={16} className="inline"/> {accountsOpen?'POS':'Accounts'}</button>}
        <button type="button" className="btn2 !min-h-10 !py-2" onClick={logout}><LogOut size={16} className="inline"/> Sign out</button>
      </div>
    </div>
    {error && <div role="alert" className="mx-auto mt-2 max-w-2xl px-3 text-sm text-red-700 sm:px-5">{error}</div>}
    {session.user.isPrimaryAdmin && accountsOpen && <AccountManagement onClose={()=>setAccountsOpen(false)}/>}
    <div className={accountsOpen?'hidden':''}>
      <POSApp user={session.user} initialData={session.data} onPersistData={persistData} onPersistenceError={onPersistenceError}/>
    </div>
  </div>;
}
