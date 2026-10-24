declare module '*.txt?raw' {
  const text: string;
  export default text;
}

declare module '*.png' {
  const url: string;
  export default url;
}
