export interface TransparencySection {
  title: string;
  body: string;
}

export const TRANSPARENCY_SECTIONS: TransparencySection[] = [
  {
    title: "What Photonic does",
    body: "It copies the photos and videos you choose from this computer to your Google Photos account. It is one-way: it never deletes, moves, or renames your originals or your cloud items.",
  },
  {
    title: "Where your photos go",
    body: "Photos travel directly from this computer to Google Photos. There is no Photonic server, relay, account, or cloud copy.",
  },
  {
    title: "Your connection",
    body: "Photonic uses a sign-in key from the modified Photos app (ReVanced) on your Android phone. The key is kept in your desktop's password manager and usually expires after about a day. Reconnect replaces it; Disconnect removes it.",
  },
  {
    title: "Account risk",
    body: "This is an unofficial upload path, not an official Google app. Google may rate-limit, restrict, suspend, or terminate the connected account, and the \"unlimited\" behavior is not guaranteed. Use a test or secondary account first and keep independent backups.",
  },
  {
    title: "What stays on this computer",
    body: "Photonic keeps backup history, file paths, and outcomes in a local database, plus a redacted troubleshooting log. It does not keep copies of your media or your sign-in key in those files.",
  },
  {
    title: "What Photonic never does",
    body: "It never asks for your Google password, never runs a hosted service, never sends analytics or telemetry, and never deletes or renames items in Google Photos.",
  },
  {
    title: "Disconnecting",
    body: "Disconnect removes the saved sign-in key from your password manager. It does not delete anything already in Google Photos, and it does not touch your originals.",
  },
  {
    title: "Honesty about limits",
    body: "Photonic depends on an unofficial mobile API that can change without notice. There is no promise of unlimited storage, permanent access, or that every video will be processed the same way. Keep your originals.",
  },
];
