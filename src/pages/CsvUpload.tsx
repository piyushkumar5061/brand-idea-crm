import { useState, useRef, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Upload, FileText, ArrowRight } from 'lucide-react';

type Step = 'upload' | 'map';

const CORE_FIELDS = [
  { key: 'name', label: 'Lead Name (required)', required: true },
  { key: 'phone', label: 'Phone (required)', required: true },
  { key: 'source', label: 'Institution / School Name' },
  { key: 'email', label: 'Email' },
  { key: 'status', label: 'Pipeline Status' },
];

export default function CsvUpload() {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = text.split('\n').filter(r => r.trim()).map(r => r.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
      const hdrs = parsed[0] || [];
      setHeaders(hdrs);
      setRows(parsed.slice(1));

      const autoMap: Record<string, string> = {};
      hdrs.forEach(h => {
        const low = h.toLowerCase();
        if (low.includes('name') && !autoMap.name) autoMap.name = h;
        else if ((low.includes('phone') || low.includes('mobile') || low.includes('number')) && !autoMap.phone) autoMap.phone = h;
        else if ((low.includes('source') || low.includes('school') || low.includes('institution')) && !autoMap.source) autoMap.source = h;
        else if (low.includes('email') && !autoMap.email) autoMap.email = h;
        else if (low.includes('status') && !autoMap.status) autoMap.status = h;
      });
      setMapping(autoMap);
      setStep('map');
    };
    reader.readAsText(f);
  };

  const unmappedHeaders = useMemo(() => {
    const mappedValues = new Set(Object.values(mapping));
    return headers.filter(h => !mappedValues.has(h));
  }, [headers, mapping]);

  const canProceed = mapping.name && mapping.phone;

  const handleUpload = async () => {
    if (!canProceed || !user) return;
    setUploading(true);
    try {
      const nameIdx = headers.indexOf(mapping.name);
      const phoneIdx = headers.indexOf(mapping.phone);
      const sourceIdx = mapping.source ? headers.indexOf(mapping.source) : -1;
      const emailIdx = mapping.email ? headers.indexOf(mapping.email) : -1;
      const statusIdx = mapping.status ? headers.indexOf(mapping.status) : -1;
      const mappedIndices = new Set([nameIdx, phoneIdx, sourceIdx, emailIdx, statusIdx].filter(i => i >= 0));

      const leads = rows.map(cols => {
        const customFields: Record<string, string> = {};
        headers.forEach((h, i) => {
          if (!mappedIndices.has(i) && cols[i]) {
            customFields[h] = cols[i];
          }
        });
        if (emailIdx >= 0 && cols[emailIdx]) customFields['email'] = cols[emailIdx];

        return {
          name: cols[nameIdx] || 'Unknown',
          phone: cols[phoneIdx] || '',
          source: sourceIdx >= 0 ? cols[sourceIdx] || null : null,
          current_status: statusIdx >= 0 && cols[statusIdx] ? cols[statusIdx] : 'new',
          custom_fields: Object.keys(customFields).length > 0 ? customFields : {},
        };
      }).filter(l => l.phone);

      // Batch insert in chunks of 500
      for (let i = 0; i < leads.length; i += 500) {
        const chunk = leads.slice(i, i + 500);
        const { error } = await supabase.from('leads').insert(chunk as any);
        if (error) throw error;
      }

      toast.success(`${leads.length} leads uploaded successfully!`);
      setFile(null);
      setHeaders([]);
      setRows([]);
      setMapping({});
      setStep('upload');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Bulk CSV Upload</h1>

      {step === 'upload' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upload Leads</CardTitle>
            <CardDescription>Upload a CSV with Lead Name, Phone, Institution, Email, and Status columns</CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => inputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
            >
              <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Click or drag CSV file here</p>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'map' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Map Columns — {file?.name}
            </CardTitle>
            <CardDescription>
              Map your CSV columns to CRM fields. Unmapped columns will be saved as extra data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {CORE_FIELDS.map(field => (
              <div key={field.key} className="grid grid-cols-1 sm:grid-cols-[180px_1fr] items-center gap-2">
                <Label className="font-medium">{field.label}</Label>
                <Select
                  value={mapping[field.key] || ''}
                  onValueChange={v => setMapping(prev => ({ ...prev, [field.key]: v === '_none_' ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select CSV column..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none_">— Skip —</SelectItem>
                    {headers.map(h => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}

            {unmappedHeaders.length > 0 && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  These columns will be stored as extra data:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {unmappedHeaders.map(h => (
                    <span key={h} className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">{h}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <p className="text-xs font-medium text-muted-foreground mb-2">Preview (first 5 rows)</p>
              <table className="w-full text-xs">
                <thead>
                  <tr>{headers.map((h, i) => <th key={i} className="text-left p-2 bg-muted font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>{row.map((c, j) => <td key={j} className="p-2 border-t border-border">{c}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between gap-2 pt-2">
              <Button variant="outline" onClick={() => { setStep('upload'); setFile(null); setHeaders([]); setRows([]); setMapping({}); }}>
                Back
              </Button>
              <Button onClick={handleUpload} disabled={!canProceed || uploading}>
                {uploading ? 'Uploading...' : (
                  <>Upload {rows.length} Leads <ArrowRight className="w-4 h-4 ml-1" /></>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
