import './styles/base.css';
import './styles/shell.css';
import './styles/ribbon.css';
import './ai/ai.css';
import { startShell } from './core/shell.js';

startShell(document.getElementById('app'));
