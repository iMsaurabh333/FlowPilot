declare module "@sap/xsenv" {
  interface ServiceQuery {
    [name: string]: {
      tag?: string;
      name?: string;
      label?: string;
    };
  }

  interface ServiceBindings {
    [name: string]: unknown;
  }

  const xsenv: {
    getServices(query: ServiceQuery): ServiceBindings;
  };

  export default xsenv;
}
