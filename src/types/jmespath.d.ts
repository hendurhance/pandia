declare module 'jmespath' {
  const jmespath: {
    search: (data: any, query: string) => any;
    compile: (query: string) => any;
  };
  export default jmespath;
}
