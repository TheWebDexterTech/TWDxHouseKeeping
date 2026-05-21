export default [
  {
    files: ["src/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        process:         "readonly",
        console:         "readonly",
        setTimeout:      "readonly",
        clearTimeout:    "readonly",
        fetch:           "readonly",
        AbortController: "readonly",
        URL:             "readonly",
        module:          "readonly",
        require:         "readonly",
        __dirname:       "readonly",
        __filename:      "readonly",
      },
    },
    rules: {
      "no-unused-vars":        ["error", { argsIgnorePattern: "^_" }],
      "no-console":            "off",
      "no-constant-condition": "error",
      "no-unreachable":        "error",
      "no-var":                "error",
      "prefer-const":          "error",
      "eqeqeq":                ["error", "always"],
      "curly":                 ["error", "all"],
      "no-throw-literal":      "error",
      "no-undef":              "error",
    },
  },
  {
    files: ["test/**/*.js"],
    rules: {
      "no-unused-vars": "warn",
    },
  },
];
