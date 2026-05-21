import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { checkPayment, payForWeek } from '../lib/paystack'

const WEEKS = Array.from({ length: 12 }, (_, i) => i + 1)

const EMPTY_ROW = {
  lesson_no: '', strand: '', sub_strand: '',
  work_done: '', reflection: ''
}

export default function Schemes({ showToast }) {
  const { user, profile } = useAuth()
  const [week, setWeek] = useState('')
  const [date, setDate] = useState('')
  const [rows, setRows] = useState([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }])
  const [paymentOk, setPaymentOk] = useState(null)
  const [paying, setPaying] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState([])

  useEffect(() => { loadSavedWeeks() }, [user])

  useEffect(() => {
    if (!week || !user) { setPaymentOk(null); return }
    setPaymentOk(null)
    checkPayment(user.id, parseInt(week)).then(ok => setPaymentOk(ok))
    loadScheme(parseInt(week))
  }, [week, user])

  async function loadSavedWeeks() {
    const { data } = await supabase.from('schemes').select('week').eq('user_id', user.id)
    if (data) setSaved([...new Set(data.map(d => d.week))])
  }

  async function loadScheme(w) {
    setLoading(true)
    const { data } = await supabase.from('schemes').select('*').eq('user_id', user.id).eq('week', w).order('row_index')
    if (data && data.length > 0) {
      setDate(data[0].date || '')
      setRows(data.map(d => ({
        lesson_no: d.lesson_no || '', strand: d.strand || '',
        sub_strand: d.sub_strand || '', work_done: d.work_done || '',
        reflection: d.reflection || ''
      })))
    } else {
      setDate('')
      setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }])
    }
    setLoading(false)
  }

  function updateRow(i, field, val) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  function addRow() { setRows(prev => [...prev, { ...EMPTY_ROW }]) }

  function removeRow(i) {
    if (rows.length <= 1) return
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handlePay() {
    setPaying(true)
    try {
      await payForWeek({
        userId: user.id, email: user.email, week: parseInt(week),
        onSuccess: () => { setPaymentOk(true); showToast('Payment confirmed! You can now save Week ' + week + ' record') },
        onClose: () => setPaying(false),
      })
    } catch (err) {
      showToast('Payment error: ' + err.message, 'error')
    } finally { setPaying(false) }
  }

  async function handleSave() {
    if (!week) { showToast('Select a week first', 'warning'); return }
    if (!paymentOk) { showToast('Please pay for Week ' + week + ' first', 'warning'); return }
    setSaving(true)
    await supabase.from('schemes').delete().eq('user_id', user.id).eq('week', parseInt(week))
    const payload = rows.map((r, i) => ({
      user_id: user.id, week: parseInt(week), date, row_index: i, ...r
    }))
    const { error } = await supabase.from('schemes').insert(payload)
    setSaving(false)
    if (error) { showToast('Error: ' + error.message, 'error'); return }
    showToast('Week ' + week + ' record saved!')
    loadSavedWeeks()
  }

  async function generatePDF(weeksToExport) {
    showToast('Generating PDF…')
    const { data } = await supabase.from('schemes').select('*')
      .eq('user_id', user.id)
      .in('week', weeksToExport)
      .order('week').order('row_index')
    if (!data || data.length === 0) { showToast('No record data found for selected weeks', 'warning'); return }

    const byWeek = {}
    data.forEach(r => { if (!byWeek[r.week]) byWeek[r.week] = []; byWeek[r.week].push(r) })

    const name = profile?.full_name || user?.email?.split('@')[0] || ''
    const school = profile?.institution || ''
    const grade = profile?.grade || ''
    const learningArea = profile?.learning_area || ''

    const cols = [
      { key: 'lesson_no', label: 'Lesson No.', w: '8%' },
      { key: 'strand', label: 'Strand', w: '18%' },
      { key: 'sub_strand', label: 'Sub Strand', w: '18%' },
      { key: 'work_done', label: 'Work Done / Skills Learned', w: '30%' },
      { key: 'reflection', label: 'Reflection', w: '18%' },
    ]

    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>CBE Record of Work</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; }
  .page { padding: 12mm; page-break-after: always; }
  .page:last-child { page-break-after: avoid; }
  h2 { font-size: 13pt; text-align: center; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 1px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-bottom: 10px; font-size: 9pt; }
  .meta-item { display: flex; gap: 4px; }
  .meta-item label { font-weight: bold; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #1C1917; color: white; padding: 5px 4px; text-align: center; font-size: 8pt; border: 1px solid #444; }
  td { border: 1px solid #ccc; padding: 4px; vertical-align: top; font-size: 8pt; line-height: 1.4; }
  td.week-col { text-align: center; font-weight: bold; background: #f5f5f0; }
  tr:nth-child(even) td { background: #fafaf8; }
  tr:nth-child(even) td.week-col { background: #f0f0ea; }
  .sig-col { text-align: center; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none; }
  }
</style></head><body>`

    Object.entries(byWeek).forEach(([w, wRows]) => {
      const wDate = wRows[0]?.date || ''
      html += `<div class="page">
  <h2>CBE Record of Work</h2>
  <div class="meta">
    <div class="meta-item"><label>Name of Teacher:</label><span>${name}</span></div>
    <div class="meta-item"><label>School:</label><span>${school}</span></div>
    ${grade ? `<div class="meta-item"><label>Grade:</label><span>${grade}</span></div>` : ''}
    ${learningArea ? `<div class="meta-item"><label>Learning Area:</label><span>${learningArea}</span></div>` : ''}
    <div class="meta-item"><label>Week:</label><span>${w}</span></div>
    ${wDate ? `<div class="meta-item"><label>Date:</label><span>${wDate}</span></div>` : ''}
  </div>
  <table>
    <thead><tr>
      <th style="width:5%">WEEK</th>
      <th style="width:7%">DATE</th>
      ${cols.map(c => `<th style="width:${c.w}">${c.label.toUpperCase()}</th>`).join('')}
      <th style="width:8%">SIGNATURE</th>
    </tr></thead>
    <tbody>`
      wRows.forEach((r, i) => {
        html += `<tr>
        ${i === 0 ? `<td class="week-col" rowspan="${wRows.length}">${w}</td><td rowspan="${wRows.length}" style="text-align:center">${wDate}</td>` : ''}
        ${cols.map(c => `<td>${r[c.key] || ''}</td>`).join('')}
        <td class="sig-col">&nbsp;</td>
      </tr>`
      })
      html += `</tbody></table></div>`
    })

    html += `<script>window.onload=()=>{window.print()}<\/script></body></html>`
    const w2 = window.open('', '_blank')
    w2.document.write(html)
    w2.document.close()
  }

  const weekPaid = paymentOk === true
  const weekUnpaid = paymentOk === false
  const weekChecking = paymentOk === null && week

  const cols = [
    { key: 'lesson_no', label: 'Lesson No.', w: 80 },
    { key: 'strand', label: 'Strand', w: 160 },
    { key: 'sub_strand', label: 'Sub Strand', w: 160 },
    { key: 'work_done', label: 'Work Done / Skills Learned', w: 220 },
    { key: 'reflection', label: 'Reflection', w: 160 },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ fontFamily: 'Playfair Display,serif', fontSize: 28, fontWeight: 400 }}>CBE Record of Work</h1>
        <div style={{ fontSize: 14, color: 'var(--ink-light)', marginTop: 3 }}>Enter and manage your weekly CBE records</div>
      </div>

      {/* Week selector + date */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row2" style={{ gap: 12 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Week Number *</label>
            <select value={week} onChange={e => setWeek(e.target.value)}>
              <option value="">Select week…</option>
              {WEEKS.map(w => (
                <option key={w} value={w}>
                  Week {w} {saved.includes(w) ? '✓' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Payment banners */}
      {weekChecking && (
        <div style={{ background: 'var(--cream-dark)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, color: 'var(--ink-light)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Checking payment…
        </div>
      )}
      {weekPaid && (
        <div style={{ background: 'var(--green-light)', border: '1px solid rgba(22,101,52,0.2)', borderRadius: 'var(--radius)', padding: '10px 14px', fontSize: 13, color: 'var(--green)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="ti ti-circle-check-filled" /> Week {week} payment confirmed — you can save this record.
        </div>
      )}
      {weekUnpaid && (
        <div style={{ background: 'var(--gold-light)', border: '1px solid rgba(180,83,9,0.2)', borderRadius: 'var(--radius)', padding: '12px 14px', fontSize: 13, color: 'var(--gold)', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <i className="ti ti-lock" /> Week {week} not paid
          </div>
          <div style={{ marginBottom: 10 }}>Pay <strong>KES 40</strong> to save the record for Week {week}.</div>
          <button type="button" className="btn btn-green btn-sm" onClick={handlePay} disabled={paying}>
            <i className="ti ti-credit-card" /> {paying ? 'Opening…' : 'Pay KES 40 via Paystack'}
          </button>
        </div>
      )}

      {/* Table */}
      {week && (
        <>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><div className="spinner" /></div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '1rem' }}>
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: 'var(--ink)' }}>
                      <th style={{ ...thStyle, width: 40 }}>#</th>
                      {cols.map(c => (
                        <th key={c.key} style={{ ...thStyle, width: c.w, minWidth: c.w }}>{c.label}</th>
                      ))}
                      <th style={{ ...thStyle, width: 80 }}>Signature</th>
                      <th style={{ ...thStyle, width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafaf8' }}>
                        <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--ink-light)', fontSize: 12 }}>{i + 1}</td>
                        {cols.map(c => (
                          <td key={c.key} style={tdStyle}>
                            <textarea
                              value={row[c.key]}
                              onChange={e => updateRow(i, c.key, e.target.value)}
                              style={taStyle}
                              rows={2}
                            />
                          </td>
                        ))}
                        <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--ink-faint)', fontSize: 11 }}>—</td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <button onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-faint)', fontSize: 16, padding: 4 }} title="Remove row">
                            <i className="ti ti-trash" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Table footer */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'white' }}>
                <button onClick={addRow} className="btn btn-ghost btn-sm">
                  <i className="ti ti-plus" /> Add row
                </button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleSave} className="btn btn-primary btn-sm" disabled={saving || !paymentOk}>
                    <i className="ti ti-device-floppy" /> {saving ? 'Saving…' : 'Save Record'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* PDF Export */}
      {saved.length > 0 && (
        <div className="card">
          <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: '1rem' }}>
            <i className="ti ti-file-type-pdf" style={{ color: 'var(--gold)', marginRight: 6 }} />
            Export Record PDF
          </h3>
          <p style={{ fontSize: 13, color: 'var(--ink-light)', marginBottom: '1rem' }}>
            Generate a printable PDF of your CBE records. Select one or more weeks.
          </p>
          <PDFExport saved={saved} onExport={generatePDF} />
        </div>
      )}

      {!week && saved.length === 0 && (
        <div className="empty">
          <i className="ti ti-table" />
          <p>Select a week above to start filling in your CBE record of work.</p>
        </div>
      )}
    </div>
  )
}

function PDFExport({ saved, onExport }) {
  const [selected, setSelected] = useState([])

  function toggle(w) {
    setSelected(prev => prev.includes(w) ? prev.filter(x => x !== w) : [...prev, w])
  }

  function selectAll() { setSelected([...saved]) }
  function clearAll() { setSelected([]) }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem' }}>
        <button className="btn btn-ghost btn-sm" onClick={selectAll}><i className="ti ti-checks" /> Select all</button>
        <button className="btn btn-ghost btn-sm" onClick={clearAll}><i className="ti ti-x" /> Clear</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '1rem' }}>
        {saved.sort((a, b) => a - b).map(w => (
          <button key={w} onClick={() => toggle(w)} style={{
            padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
            cursor: 'pointer', fontFamily: 'Outfit,sans-serif', transition: 'all .15s',
            border: selected.includes(w) ? 'none' : '1px solid var(--border-mid)',
            background: selected.includes(w) ? 'var(--ink)' : 'white',
            color: selected.includes(w) ? 'white' : 'var(--ink-mid)',
          }}>
            Week {w}
          </button>
        ))}
      </div>
      <button
        className="btn btn-primary"
        disabled={selected.length === 0}
        onClick={() => onExport(selected)}
        style={{ marginBottom: '5rem' }}
      >
        <i className="ti ti-file-type-pdf" /> Generate PDF {selected.length > 0 ? `(${selected.length} week${selected.length > 1 ? 's' : ''})` : ''}
      </button>
    </div>
  )
}

const thStyle = {
  padding: '10px 8px', textAlign: 'left',
  fontSize: 11, fontWeight: 600, color: 'white',
  borderRight: '1px solid rgba(255,255,255,0.1)',
  letterSpacing: '.03em', whiteSpace: 'nowrap',
}

const tdStyle = {
  padding: '4px', borderBottom: '1px solid var(--border)',
  borderRight: '1px solid var(--border)', verticalAlign: 'top',
}

const taStyle = {
  width: '100%', border: 'none', background: 'transparent',
  resize: 'none', fontFamily: 'Outfit,sans-serif',
  fontSize: 12, color: 'var(--ink)', lineHeight: 1.5,
  outline: 'none', padding: '2px 4px',
}
