import { TRUCK_SRC } from './lib/decor';

export default function Home() {
  return (
    <div className="home">
      <img src={TRUCK_SRC} alt="Camioncino Busa" />
      <h1>Tombola Busa</h1>
      <div className="home-links">
        <a className="btn" href="/display">Tabellone (proiettore)</a>
        <a className="btn" href="/control">Telecomando</a>
        <a className="btn secondary" href="/admin">CMS</a>
      </div>
      <p>Sul telefono del conduttore apri il QR di abbinamento dal CMS (Panoramica).</p>
    </div>
  );
}
