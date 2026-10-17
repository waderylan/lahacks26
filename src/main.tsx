import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyDemoResetFromUrl } from './resetDemo';

applyDemoResetFromUrl();
createRoot(document.getElementById('root')!).render(<App />);
