import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyDemoResetFromUrl } from './resetDemo';

try { await applyDemoResetFromUrl(); }
catch (error) {
  const alert = document.createElement('p'); alert.setAttribute('role', 'alert');
  alert.textContent = (error as Error).message; document.body.prepend(alert);
}
createRoot(document.getElementById('root')!).render(<App />);
