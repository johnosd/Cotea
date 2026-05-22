import { SessionProvider } from "next-auth/react";
import "../styles/globals.css"; // Se você tiver estilos globais

export default function App({ Component, pageProps }) {
  return (
    <SessionProvider session={pageProps.session}>
      <Component {...pageProps} />
    </SessionProvider>
  );
}