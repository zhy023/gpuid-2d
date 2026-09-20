import { useEffect, useRef } from 'react';
// import { runApp } from '@/demo/main';
import { runDrawioApp } from '@/demo/drawio_main';

function App() {
  const started = useRef(false);

  useEffect(() => {
    // React18/19 StrictMode 二次挂载直接跳过第二次调用
    if (started.current) return;
    started.current = true;

    runDrawioApp();
  }, []);

  return (
    <div>
      <h1>gpuid‑2d</h1>
      <canvas id="canvas" width="1000" height="1000"></canvas>
    </div>
  );
}

export default App;
