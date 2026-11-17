import { Link } from 'react-router';
import { APP, copyrightYear } from '../lib/brand';

function About() {
  return (
    <div className="prose">
      <p>{APP.name} ({APP.shortName}) is an independent, open-source character creation and management tool for Source Filmmaker projects, developed by <a href={APP.authorUrl} rel="noopener">{APP.author}</a> as part of the {APP.network}.</p>
      <p>It exists to cut down the manual setup work in TF2 animation: build a character once, with its model, team, cosmetics, paints and notes, and export a render and a precise specification you can reuse for every scene.</p>
      <h2>Not affiliated with Valve</h2>
      <p>SFMC Studio is not affiliated with, endorsed by or sponsored by Valve Corporation. Team Fortress 2, Source Filmmaker, the TF2 characters, items and artwork are trademarks and copyrighted works of Valve Corporation. Workshop and community models belong to their respective authors. SFMC Studio does not host or redistribute any of these assets: models and textures are read from files on your own computer.</p>
      <h2>Licensing</h2>
      <ul>
        <li><strong>Application code and original assets</strong> (interface, icons, the test mannequin): © {copyrightYear()} {APP.author}, released under the <a href={`${APP.repo}/blob/main/LICENSE`} rel="noopener">MIT License</a>.</li>
        <li><strong>Third-party libraries</strong>: see <a href={`${APP.repo}/blob/main/THIRD_PARTY_NOTICES.md`} rel="noopener">THIRD_PARTY_NOTICES.md</a>, including the MIT-licensed Source model parsers by Garrett Johnson.</li>
        <li><strong>Item metadata</strong>: generated from Valve's public TF2 item schema via the tsuza/tf2-item-schema mirror. Names and data remain Valve's.</li>
      </ul>
      <h2>Contribute</h2>
      <p>Source code, issues and contributions: <a href={APP.repo} rel="noopener">{APP.repo}</a>. You are welcome to fork and self-host it.</p>
      <p>Official website: <a href={APP.url}>{APP.url}</a> · Author: <a href={APP.authorUrl} rel="noopener">darkzmaj.eu</a></p>
    </div>
  );
}

function Privacy() {
  return (
    <div className="prose">
      <p><strong>Short version: your characters never leave your browser unless you export them yourself.</strong></p>
      <h2>What is stored, and where</h2>
      <ul>
        <li>Characters, descriptions, version history, thumbnails, reference images, imported model files, custom model types and settings are stored in your browser's IndexedDB for this website.</li>
        <li>Nothing of this is uploaded. There are no accounts, no shared server database, no public profiles, no galleries and no shareable project links.</li>
        <li>Your TF2 folder is read in place by your browser. Chrome and Edge remember the folder permission; the files themselves are not copied.</li>
      </ul>
      <h2>Who can see it</h2>
      <p>Each visitor's data is isolated by the browser's same-origin storage rules. Another visitor of this website cannot read, search, change or export your data. Browser storage is separated per browser profile and per website, not per person: anyone using the same unlocked browser profile on your device can open your characters.</p>
      <h2>How it can be lost</h2>
      <ul>
        <li>Clearing browsing data or site data for this website.</li>
        <li>Private or incognito windows, which discard storage when closed.</li>
        <li>Storage eviction when your disk is nearly full (less likely when persistent storage is granted in Settings).</li>
        <li>Uninstalling the browser or resetting the profile.</li>
      </ul>
      <p>Download regular ZIP backups from the <Link to="/backups">Backups</Link> page.</p>
      <h2>Network requests</h2>
      <p>The site loads its own code, fonts, catalog files and (where the operator hosts them) TF2 model files from this domain only. Steam Market links open steamcommunity.com only when you click them. It uses no analytics, no trackers, no advertising and no third-party scripts or fonts. A strict Content Security Policy blocks connections to other hosts. The server keeps standard access logs (IP address, time, requested file) as any web server does; these never include your project data.</p>
      <h2>Imported files</h2>
      <p>Imported files are validated (allowed types, size limits, header checks, safe paths) and are only ever parsed as data. They cannot run scripts. Character files and backups you import are checked against the expected format before anything is stored.</p>
      <p>Questions: see the contact details at <a href={APP.authorUrl} rel="noopener">darkzmaj.eu</a>.</p>
    </div>
  );
}

function Docs() {
  return (
    <div className="prose">
      <h2>Quick start</h2>
      <ul>
        <li><strong>Link game files.</strong> On <Link to="/imports">Imports</Link>, choose your Team Fortress 2 folder (Chrome/Edge) or select the <code>tf2_misc</code> and <code>tf2_textures</code> VPK files.</li>
        <li><strong>Create.</strong> In the <Link to="/editor">editor</Link>, pick a class and a team. Search cosmetics on the left and click to equip; click again to remove.</li>
        <li><strong>Customise.</strong> In the Equipped tab, expand an item to change style, paint, offset, rotation and scale, or hide and reorder it. Appearance holds pose, skin and bodygroups.</li>
        <li><strong>Describe.</strong> The Profile tab stores name, personality, voice, outfit, animation and story notes plus reference images.</li>
        <li><strong>Save and export.</strong> <span className="kbd">Ctrl</span>+<span className="kbd">S</span> saves a version. Export a PNG, manifest JSON, Markdown spec, ZIP bundle or GLB.</li>
      </ul>
      <h2>Viewer controls</h2>
      <ul>
        <li>Left-drag: orbit. Right-drag or Shift-drag: pan. Wheel: zoom toward cursor.</li>
        <li><span className="kbd">1</span> front, <span className="kbd">2</span> back, <span className="kbd">3</span> left, <span className="kbd">4</span> right, <span className="kbd">5</span> top, <span className="kbd">0</span> three-quarter, <span className="kbd">R</span> reset, <span className="kbd">F</span> fullscreen, <span className="kbd">G</span> grid, <span className="kbd">O</span> orthographic.</li>
        <li><span className="kbd">Ctrl</span>+<span className="kbd">Z</span> undo, <span className="kbd">Ctrl</span>+<span className="kbd">Shift</span>+<span className="kbd">Z</span> redo.</li>
      </ul>
      <h2>Try Out and prices</h2>
      <p>The <Link to="/try">Try Out</Link> page lets you pick one of the nine classes, try cosmetics on in 3D and see the estimated cost of the loadout. Prices are a snapshot of the lowest Steam Community Market listing for the Unique quality, in USD. They change constantly, so check the market before you buy. TF2 itself allows three cosmetics at once and blocks items that share an equip region; Try Out warns about both.</p>
      <h2>Where to get model files</h2>
      <ul>
        <li><strong>TF2 classes and cosmetics</strong>: your TF2 install. In Steam, right-click Team Fortress 2, then Manage, then Browse local files, and pick the <code>tf</code> folder on the Imports page. Some deployments of this site host them, in which case nothing is needed.</li>
        <li><strong>Saxton Hale, female variants and other community characters</strong>: the <a href="https://steamcommunity.com/app/1840/workshop/" rel="noopener">Source Filmmaker Steam Workshop</a> (subscribed items land in <code>SourceFilmmaker/game/workshop</code>) or <a href="https://sfmlab.com" rel="noopener">SFMLab</a> (ZIP downloads). Drag the folder or ZIP onto the Imports page and press Create character.</li>
        <li><strong>18+ models</strong>: SFMLab has an adult section behind its own account and age verification. Tick "This is 18+ content" when importing; such models stay hidden until you confirm your age.</li>
      </ul>
      <h2>Community models</h2>
      <p>TF2 ships no Saxton Hale or female class player models. Download a model you are allowed to use, import its folder or ZIP, then link the <code>.mdl</code> to the matching catalog entry. Official cosmetics only fit models that keep the TF2 skeleton's bone names.</p>
      <h2>More</h2>
      <p>Full documentation, the interchange format and deployment guides live in the <a href={`${APP.repo}#readme`} rel="noopener">GitHub repository</a>.</p>
    </div>
  );
}

export default function InfoPages({ page }: { page: 'about' | 'privacy' | 'docs' | '404' }) {
  const titles = { about: 'About SFMC Studio', privacy: 'Privacy', docs: 'Documentation', '404': 'Page not found' };
  return (
    <div className="page">
      <div className="page-head"><div><div className="eyebrow">{APP.name}</div><h1>{titles[page]}</h1></div></div>
      {page === 'about' && <About />}
      {page === 'privacy' && <Privacy />}
      {page === 'docs' && <Docs />}
      {page === '404' && <p className="hint">That page does not exist. <Link to="/">Go to the dashboard</Link>.</p>}
    </div>
  );
}
