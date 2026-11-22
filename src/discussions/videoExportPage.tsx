import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KonstaProvider } from 'konsta/react';
import { downloadLocalFile } from '../media/downloadLocalFile';
import { loadBrowserVideoExport } from '../media/videoExportLink';
import { Button, Text } from '../ui/primitives';
import '../ui/konsta.css';
import '../ui/tokens/index.css';
import '../theme.css';

function VideoExportPage() {
  const [file, setFile] = useState<File>();
  const [error, setError] = useState(false);
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void loadBrowserVideoExport(window.location.hash, controller.signal).then(result => {
      if (!controller.signal.aborted) setFile(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [attempt]);

  const download = () => {
    if (!file) return;
    try {
      downloadLocalFile(file);
      setRequested(true);
    } catch {
      setError(true);
    }
  };

  return <main className="k-ios dark min-h-dvh p-6">
    <div className="mx-auto flex max-w-md flex-col items-start gap-4">
      <h1><Text variant="headline">Сохранить видео Mezfit</Text></h1>
      {error ? <>
        <Text role="alert">Не удалось сохранить видео. Проверьте подключение и повторите попытку.</Text>
        <Button onClick={() => { setError(false); setRequested(false); setAttempt(value => value + 1); }}>Повторить</Button>
      </> : file ? <>
        <Button onClick={download}>Скачать файл</Button>
        {requested && <Text role="status">Проверьте, началось ли скачивание в браузере.</Text>}
      </> : <Text role="status">Подготавливаем видео…</Text>}
    </div>
  </main>;
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<KonstaProvider theme="ios" dark><VideoExportPage /></KonstaProvider>);
